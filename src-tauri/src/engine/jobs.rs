use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::json;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::mpsc;

use super::worker::{Worker, WorkerEvent};
use crate::export::{self, Segment};
use crate::history::Record;
use crate::Ctx;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Queued,
    Loading,
    Downloading,
    Transcribing,
    Done,
    Failed,
    Cancelled,
}

impl JobState {
    pub fn active(self) -> bool {
        matches!(self, JobState::Loading | JobState::Downloading | JobState::Transcribing)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    pub model: String,
    pub language: String,
    pub state: JobState,
    pub stage: String,
    pub position: f64,
    pub duration: f64,
    pub speed: f64,
    pub bytes: u64,
    pub total: u64,
    pub detected_language: Option<String>,
    pub segment_count: usize,
    pub error: Option<String>,
    pub hint: Option<String>,
    pub detail: Option<String>,
    pub device: Option<String>,
    pub compute_type: Option<String>,
    pub elapsed: Option<f64>,
    pub added_at: i64,
    pub finished_at: Option<i64>,
    pub exported: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum UiEvent {
    Job { job: Box<Job> },
    Removed { id: String },
    Segment { id: String, segment: Segment },
    Paused { paused: bool },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub jobs: Vec<Job>,
    pub paused: bool,
}

pub enum Msg {
    Kick,
    Cancel(String),
    Restart,
    Shutdown,
}

#[derive(Default)]
struct Inner {
    jobs: Vec<Job>,
    segments: HashMap<String, Vec<Segment>>,
    channel: Option<Channel<UiEvent>>,
    paused: bool,
}

impl Inner {
    fn emit(&self, ev: UiEvent) {
        if let Some(ch) = &self.channel {
            let _ = ch.send(ev);
        }
    }
}

pub struct Jobs {
    inner: Mutex<Inner>,
    tx: mpsc::UnboundedSender<Msg>,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn new_id() -> String {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    format!("{:x}{:04x}", now_ms(), SEQ.fetch_add(1, Ordering::Relaxed) & 0xffff)
}

impl Jobs {
    pub fn new() -> (Arc<Self>, mpsc::UnboundedReceiver<Msg>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Arc::new(Self { inner: Mutex::new(Inner::default()), tx }), rx)
    }

    pub fn send(&self, msg: Msg) {
        let _ = self.tx.send(msg);
    }

    pub fn subscribe(&self, channel: Channel<UiEvent>) -> Snapshot {
        let mut inner = self.inner.lock().unwrap();
        inner.channel = Some(channel);
        Snapshot { jobs: inner.jobs.clone(), paused: inner.paused }
    }

    /// Queues files, skipping ones that are already waiting or running.
    pub fn add(&self, files: Vec<PathBuf>, model: &str, language: &str) -> Vec<Job> {
        let mut inner = self.inner.lock().unwrap();
        let mut added = vec![];
        for path in files {
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            if !meta.is_file() {
                continue;
            }
            let p = path.to_string_lossy().into_owned();
            if inner.jobs.iter().any(|j| j.path == p && (j.state == JobState::Queued || j.state.active())) {
                continue;
            }
            let job = Job {
                id: new_id(),
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone()),
                path: p,
                size: meta.len(),
                model: model.into(),
                language: language.into(),
                state: JobState::Queued,
                stage: "Waiting".into(),
                position: 0.0,
                duration: 0.0,
                speed: 0.0,
                bytes: 0,
                total: 0,
                detected_language: None,
                segment_count: 0,
                error: None,
                hint: None,
                detail: None,
                device: None,
                compute_type: None,
                elapsed: None,
                added_at: now_ms(),
                finished_at: None,
                exported: vec![],
            };
            inner.emit(UiEvent::Job { job: Box::new(job.clone()) });
            inner.jobs.push(job.clone());
            added.push(job);
        }
        drop(inner);
        if !added.is_empty() {
            self.send(Msg::Kick);
        }
        added
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut Job)) -> Option<Job> {
        let mut inner = self.inner.lock().unwrap();
        let job = inner.jobs.iter_mut().find(|j| j.id == id)?;
        f(job);
        let job = job.clone();
        inner.emit(UiEvent::Job { job: Box::new(job.clone()) });
        Some(job)
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.inner.lock().unwrap().jobs.iter().find(|j| j.id == id).cloned()
    }

    pub fn segments(&self, id: &str) -> Option<Vec<Segment>> {
        self.inner.lock().unwrap().segments.get(id).cloned()
    }

    fn push_segment(&self, id: &str, segment: Segment) {
        let mut inner = self.inner.lock().unwrap();
        inner.segments.entry(id.to_string()).or_default().push(segment.clone());
        inner.emit(UiEvent::Segment { id: id.to_string(), segment });
    }

    fn next_queued(&self) -> Option<Job> {
        let inner = self.inner.lock().unwrap();
        if inner.paused {
            return None;
        }
        inner.jobs.iter().find(|j| j.state == JobState::Queued).cloned()
    }

    pub fn cancel(&self, id: &str) {
        let Some(job) = self.get(id) else { return };
        if job.state == JobState::Queued {
            self.update(id, |j| {
                j.state = JobState::Cancelled;
                j.stage = "Cancelled".into();
            });
        } else if job.state.active() {
            self.update(id, |j| j.stage = "Cancelling".into());
            self.send(Msg::Cancel(id.into()));
        }
    }

    pub fn retry(&self, id: &str, model: &str, language: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.segments.remove(id);
        let Some(j) = inner.jobs.iter_mut().find(|j| j.id == id && matches!(j.state, JobState::Failed | JobState::Cancelled)) else { return };
        j.state = JobState::Queued;
        j.stage = "Waiting".into();
        j.model = model.into();
        j.language = language.into();
        (j.error, j.hint, j.detail, j.detected_language) = (None, None, None, None);
        (j.position, j.speed, j.segment_count) = (0.0, 0.0, 0);
        let job = j.clone();
        inner.emit(UiEvent::Job { job: Box::new(job) });
        drop(inner);
        self.send(Msg::Kick);
    }

    /// Removes finished jobs; active ones must be cancelled first.
    pub fn remove(&self, ids: &[String]) {
        let mut inner = self.inner.lock().unwrap();
        let removable: Vec<String> = inner.jobs.iter().filter(|j| ids.contains(&j.id) && !j.state.active()).map(|j| j.id.clone()).collect();
        inner.jobs.retain(|j| !removable.contains(&j.id));
        for id in removable {
            inner.segments.remove(&id);
            inner.emit(UiEvent::Removed { id });
        }
    }

    pub fn clear_finished(&self) {
        let ids: Vec<String> = {
            let inner = self.inner.lock().unwrap();
            inner.jobs.iter().filter(|j| matches!(j.state, JobState::Done | JobState::Failed | JobState::Cancelled)).map(|j| j.id.clone()).collect()
        };
        self.remove(&ids);
    }

    pub fn set_paused(&self, paused: bool) {
        let mut inner = self.inner.lock().unwrap();
        inner.paused = paused;
        inner.emit(UiEvent::Paused { paused });
        drop(inner);
        self.send(Msg::Kick);
    }

    fn fail(&self, id: &str, error: String, hint: Option<String>, detail: Option<String>) {
        self.update(id, |j| {
            j.state = JobState::Failed;
            j.stage = "Failed".into();
            j.error = Some(error);
            j.hint = hint;
            j.detail = detail.filter(|d| !d.trim().is_empty());
            j.finished_at = Some(now_ms());
        });
    }
}

async fn next_event(worker: &mut Option<Worker>) -> Option<WorkerEvent> {
    match worker {
        Some(w) => w.events.recv().await,
        None => std::future::pending().await,
    }
}

/// The engine actor: owns the worker process and runs one job at a time.
pub async fn run(app: AppHandle, mut rx: mpsc::UnboundedReceiver<Msg>) {
    let ctx = app.state::<Ctx>();
    let jobs = ctx.jobs.clone();
    let mut worker: Option<Worker> = None;
    let mut current: Option<String> = None;

    loop {
        if current.is_none() && ctx.paths.python().exists()
            && let Some(job) = jobs.next_queued() {
                let s = ctx.settings.get();
                if worker.is_none() {
                    match Worker::spawn(&ctx.paths) {
                        Ok(w) => worker = Some(w),
                        Err(e) => {
                            jobs.fail(&job.id, format!("Couldn't start the engine: {e}"), Some("Open Settings → Engine and run Repair.".into()), None);
                            continue;
                        }
                    }
                }
                let cmd = json!({
                    "cmd": "transcribe", "job_id": job.id, "file": job.path, "model": job.model, "language": job.language,
                    "device": s.device, "beam_size": s.beam_size, "vad": s.vad, "initial_prompt": s.initial_prompt,
                });
                if let Err(e) = worker.as_mut().unwrap().send(cmd).await {
                    let detail = worker.take().map(|w| w.stderr_tail(12));
                    jobs.fail(&job.id, format!("The engine isn't responding: {e}"), None, detail);
                    continue;
                }
                jobs.update(&job.id, |j| {
                    j.state = JobState::Loading;
                    j.stage = "Starting engine".into();
                });
                current = Some(job.id);
            }

        tokio::select! {
            msg = rx.recv() => match msg {
                None | Some(Msg::Shutdown) => {
                    if let Some(w) = worker.as_mut() {
                        let _ = w.send(json!({"cmd": "shutdown"})).await;
                    }
                    break;
                }
                Some(Msg::Kick) => {}
                Some(Msg::Cancel(id)) => {
                    if current.as_deref() == Some(id.as_str())
                        && let Some(w) = worker.as_mut() {
                            let _ = w.send(json!({"cmd": "cancel"})).await;
                        }
                }
                Some(Msg::Restart) => {
                    worker = None;
                    if let Some(id) = current.take() {
                        jobs.update(&id, |j| { j.state = JobState::Cancelled; j.stage = "Cancelled".into(); });
                    }
                }
            },
            ev = next_event(&mut worker) => match ev {
                Some(ev) => {
                    if handle(&app, &ctx, &mut current, ev) {
                        current = None;
                    }
                }
                None => {
                    let tail = worker.take().map(|w| w.stderr_tail(15)).unwrap_or_default();
                    tracing::warn!("worker exited:\n{tail}");
                    if let Some(id) = current.take() {
                        let low = tail.to_lowercase();
                        let hint = if low.contains("out of memory") || low.contains("killed") {
                            Some("The system ran out of memory. Try a smaller model.".to_string())
                        } else if low.contains("libcudnn") || low.contains("libcublas") {
                            Some("CUDA libraries failed to load. Run Settings → Engine → Repair, or switch the device to CPU.".to_string())
                        } else {
                            None
                        };
                        jobs.fail(&id, "The engine stopped unexpectedly.".into(), hint, Some(tail));
                    }
                }
            },
        }
    }
}

/// Applies one worker event. Returns true when the current job has finished.
fn handle(app: &AppHandle, ctx: &Ctx, current: &mut Option<String>, ev: WorkerEvent) -> bool {
    let jobs = &ctx.jobs;
    let is_current = |id: &str| current.as_deref() == Some(id);
    match ev {
        WorkerEvent::Status { job_id, stage, message, language, duration, device, compute_type } if is_current(&job_id) => {
            jobs.update(&job_id, |j| {
                j.state = match stage.as_str() {
                    "downloading" => JobState::Downloading,
                    "transcribing" => JobState::Transcribing,
                    _ => JobState::Loading,
                };
                if j.stage != "Cancelling" {
                    j.stage = message;
                }
                if language.is_some() {
                    j.detected_language = language;
                }
                if let Some(d) = duration {
                    j.duration = d;
                }
                if let Some(d) = device {
                    j.device = Some(d.label());
                }
                if compute_type.is_some() {
                    j.compute_type = compute_type;
                }
            });
            false
        }
        WorkerEvent::Progress { job_id, bytes, total } if is_current(&job_id) => {
            jobs.update(&job_id, |j| {
                j.state = JobState::Downloading;
                (j.bytes, j.total) = (bytes, total);
            });
            false
        }
        WorkerEvent::Segment { job_id, segment, position, duration, speed } if is_current(&job_id) => {
            jobs.push_segment(&job_id, segment);
            jobs.update(&job_id, |j| {
                j.state = JobState::Transcribing;
                j.position = position;
                j.duration = duration;
                j.speed = speed;
                j.segment_count += 1;
            });
            false
        }
        WorkerEvent::Done { job_id, duration, elapsed, language, device, compute_type } if is_current(&job_id) => {
            let segments = jobs.segments(&job_id).unwrap_or_default();
            let Some(job) = jobs.update(&job_id, |j| {
                j.state = JobState::Done;
                j.stage = "Done".into();
                j.position = duration;
                j.duration = duration;
                j.elapsed = Some(elapsed);
                j.finished_at = Some(now_ms());
                if language.is_some() {
                    j.detected_language = language;
                }
                if let Some(d) = device {
                    j.device = Some(d.label());
                }
                if compute_type.is_some() {
                    j.compute_type = compute_type;
                }
            }) else {
                return true;
            };
            finish(app, ctx, job, segments);
            true
        }
        WorkerEvent::Cancelled { job_id } if is_current(&job_id) => {
            jobs.update(&job_id, |j| {
                j.state = JobState::Cancelled;
                j.stage = "Cancelled".into();
                j.finished_at = Some(now_ms());
            });
            true
        }
        WorkerEvent::Error { job_id, error, hint } => match job_id.filter(|id| is_current(id)) {
            Some(id) => {
                jobs.fail(&id, error, hint, None);
                notify(app, ctx, "Transcription failed", &jobs.get(&id).map(|j| j.name).unwrap_or_default());
                true
            }
            None => {
                tracing::warn!("worker error: {error}");
                false
            }
        },
        _ => false,
    }
}

/// Saves the finished transcript to history, writes auto-exports and notifies.
fn finish(app: &AppHandle, ctx: &Ctx, job: Job, segments: Vec<Segment>) {
    let record = Record {
        id: job.id.clone(),
        name: job.name.clone(),
        path: job.path.clone(),
        model: job.model.clone(),
        language: job.detected_language.clone(),
        duration: job.duration,
        elapsed: job.elapsed.unwrap_or(0.0),
        device: job.device.clone(),
        created_at: job.finished_at.unwrap_or_else(now_ms),
        segments,
    };
    if let Err(e) = ctx.history.save(&record) {
        tracing::error!("saving history for {}: {e}", job.id);
    }

    let settings = ctx.settings.get();
    if !settings.auto_export.is_empty() {
        let stem = Path::new(&job.name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let mut written = vec![];
        for format in &settings.auto_export {
            match write_export(Path::new(&settings.output_dir), &stem, format, &record.segments) {
                Ok(p) => written.push(p.to_string_lossy().into_owned()),
                Err(e) => tracing::error!("auto-export {format}: {e}"),
            }
        }
        ctx.jobs.update(&job.id, |j| j.exported = written);
    }

    let words = export::plain_text(&record.segments).split_whitespace().count();
    notify(app, ctx, "Transcript ready", &format!("{} · {} words", job.name, words));
}

/// Writes one export into `dir` without overwriting existing files.
pub fn write_export(dir: &Path, stem: &str, format: &str, segments: &[Segment]) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let stem = export::safe_stem(stem);
    let suffix = export::suffix(format);
    let mut path = dir.join(format!("{stem}{suffix}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}){suffix}"));
        n += 1;
    }
    std::fs::write(&path, export::render(format, segments))?;
    Ok(path)
}

fn notify(app: &AppHandle, ctx: &Ctx, title: &str, body: &str) {
    if !ctx.settings.get().notifications {
        return;
    }
    let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    if !focused {
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let segs = vec![Segment { start: 0.0, end: 1.0, text: "hi".into() }];
        let a = write_export(dir.path(), "talk", "srt", &segs).unwrap();
        let b = write_export(dir.path(), "talk", "srt", &segs).unwrap();
        assert_eq!(a.file_name().unwrap(), "talk.srt");
        assert_eq!(b.file_name().unwrap(), "talk (2).srt");
    }

    #[test]
    fn queue_dedupes_and_cancels() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.wav");
        std::fs::write(&f, b"x").unwrap();
        let (jobs, _rx) = Jobs::new();
        assert_eq!(jobs.add(vec![f.clone(), f.clone(), dir.path().join("missing.wav")], "small", "auto").len(), 1);
        let id = jobs.next_queued().unwrap().id;
        jobs.cancel(&id);
        assert_eq!(jobs.get(&id).unwrap().state, JobState::Cancelled);
        assert!(jobs.next_queued().is_none());
        jobs.retry(&id, "base", "en");
        assert_eq!(jobs.get(&id).unwrap().model, "base");
        jobs.set_paused(true);
        assert!(jobs.next_queued().is_none());
    }
}
