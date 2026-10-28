use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

use super::env::Paths;
use crate::error::Result;
use crate::export::Segment;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Device {
    pub device: String,
    pub name: String,
}

impl Device {
    pub fn label(&self) -> String {
        if self.device == "cuda" { format!("{} · CUDA", self.name) } else { self.name.clone() }
    }
}

/// One line of the worker's stdout protocol.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerEvent {
    Ready,
    Status {
        #[serde(default)]
        job_id: String,
        #[serde(default)]
        stage: String,
        #[serde(default)]
        message: String,
        language: Option<String>,
        duration: Option<f64>,
        device: Option<Device>,
        compute_type: Option<String>,
    },
    Progress {
        #[serde(default)]
        job_id: String,
        #[serde(default)]
        bytes: u64,
        #[serde(default)]
        total: u64,
    },
    Segment {
        job_id: String,
        segment: Segment,
        #[serde(default)]
        position: f64,
        #[serde(default)]
        duration: f64,
        #[serde(default)]
        speed: f64,
    },
    Done {
        job_id: String,
        #[serde(default)]
        duration: f64,
        #[serde(default)]
        elapsed: f64,
        language: Option<String>,
        device: Option<Device>,
        compute_type: Option<String>,
    },
    Cancelled {
        #[serde(default)]
        job_id: String,
    },
    Error {
        #[serde(default)]
        job_id: Option<String>,
        error: String,
        hint: Option<String>,
    },
    #[serde(other)]
    Other,
}

/// The long-lived Python process. Dropping it kills the process.
pub struct Worker {
    _child: Child,
    stdin: ChildStdin,
    pub events: mpsc::UnboundedReceiver<WorkerEvent>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

impl Worker {
    pub fn spawn(paths: &Paths) -> Result<Self> {
        let mut child = Command::new(paths.python())
            .arg(&paths.script)
            .envs(paths.engine_env())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr_pipe = child.stderr.take().expect("piped stderr");

        let (tx, events) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match serde_json::from_str::<WorkerEvent>(&line) {
                    Ok(ev) => {
                        if tx.send(ev).is_err() {
                            break;
                        }
                    }
                    Err(e) => tracing::debug!("worker: unparsed line ({e}): {line}"),
                }
            }
        });

        let stderr = Arc::new(Mutex::new(VecDeque::new()));
        let sink = stderr.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr_pipe).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!("worker stderr: {line}");
                let mut q = sink.lock().unwrap();
                if q.len() == 40 {
                    q.pop_front();
                }
                q.push_back(line);
            }
        });

        Ok(Self { _child: child, stdin, events, stderr })
    }

    pub async fn send(&mut self, cmd: serde_json::Value) -> Result<()> {
        let mut line = serde_json::to_vec(&cmd)?;
        line.push(b'\n');
        self.stdin.write_all(&line).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    /// The last lines the worker wrote to stderr, for crash reports.
    pub fn stderr_tail(&self, n: usize) -> String {
        let q = self.stderr.lock().unwrap();
        let skip = q.len().saturating_sub(n);
        q.iter().skip(skip).cloned().collect::<Vec<_>>().join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_protocol_lines() {
        let seg: WorkerEvent = serde_json::from_str(r#"{"type":"segment","job_id":"j","segment":{"start":1.0,"end":2.0,"text":"hi"},"position":2.0,"duration":9.0,"speed":3.1}"#).unwrap();
        assert!(matches!(seg, WorkerEvent::Segment { ref segment, .. } if segment.text == "hi"));
        let unknown: WorkerEvent = serde_json::from_str(r#"{"type":"pong","busy":false}"#).unwrap();
        assert!(matches!(unknown, WorkerEvent::Other));
        let err: WorkerEvent = serde_json::from_str(r#"{"type":"error","error":"boom","hint":null}"#).unwrap();
        assert!(matches!(err, WorkerEvent::Error { job_id: None, .. }));
    }
}
