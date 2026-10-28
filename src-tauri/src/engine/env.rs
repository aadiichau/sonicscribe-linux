use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::error::{Error, Result};

const WORKER_SOURCE: &str = include_str!("../../engine/transcribe_worker.py");

/// Python versions faster-whisper (ctranslate2) ships wheels for.
const MIN_MINOR: u32 = 9;
const MAX_MINOR: u32 = 14;

pub struct Paths {
    pub data: PathBuf,
    pub venv: PathBuf,
    pub script: PathBuf,
    pub history: PathBuf,
    pub settings: PathBuf,
    pub default_output: PathBuf,
}

impl Paths {
    pub fn new(data: PathBuf, config: PathBuf, documents: Option<PathBuf>, home: PathBuf) -> Self {
        Self {
            venv: data.join("venv"),
            script: data.join("engine").join("transcribe_worker.py"),
            history: data.join("history"),
            settings: config.join("settings.json"),
            default_output: documents.unwrap_or_else(|| home.clone()).join("SonicScribe"),
            data,
        }
    }

    pub fn python(&self) -> PathBuf {
        self.venv.join("bin").join("python")
    }

    /// Writes the bundled worker script next to the venv when it changed.
    pub fn install_script(&self) -> Result<()> {
        if std::fs::read_to_string(&self.script).ok().as_deref() != Some(WORKER_SOURCE) {
            std::fs::create_dir_all(self.script.parent().unwrap())?;
            std::fs::write(&self.script, WORKER_SOURCE)?;
        }
        Ok(())
    }

    /// The NVIDIA CUDA/cuDNN libraries pip installed into the venv.
    fn cuda_lib_dirs(&self) -> Vec<PathBuf> {
        let mut out = vec![];
        let Ok(libs) = std::fs::read_dir(self.venv.join("lib")) else { return out };
        for py in libs.flatten() {
            let nvidia = py.path().join("site-packages").join("nvidia");
            if let Ok(pkgs) = std::fs::read_dir(nvidia) {
                for pkg in pkgs.flatten() {
                    let lib = pkg.path().join("lib");
                    if lib.is_dir() {
                        out.push(lib);
                    }
                }
            }
        }
        out.sort();
        out
    }

    /// Environment for any process that runs the venv's Python.
    pub fn engine_env(&self) -> Vec<(String, String)> {
        let mut ld: Vec<String> = self.cuda_lib_dirs().iter().map(|p| p.to_string_lossy().into_owned()).collect();
        ld.extend(host_paths("LD_LIBRARY_PATH"));
        vec![
            ("LD_LIBRARY_PATH".into(), ld.join(":")),
            ("PYTHONUNBUFFERED".into(), "1".into()),
            ("PYTHONNOUSERSITE".into(), "1".into()),
            ("PYTHONIOENCODING".into(), "utf-8".into()),
            ("HF_HUB_DISABLE_TELEMETRY".into(), "1".into()),
            // Xet downloads land outside the model folder, which hides download progress.
            ("HF_HUB_DISABLE_XET".into(), "1".into()),
            ("HF_HUB_DISABLE_PROGRESS_BARS".into(), "1".into()),
            ("PIP_DISABLE_PIP_VERSION_CHECK".into(), "1".into()),
        ]
    }
}

/// Entries of a path-list variable, minus those an AppImage launcher pointed into its own mount.
fn host_paths(var: &str) -> Vec<String> {
    let appdir = std::env::var("APPDIR").ok().filter(|d| !d.is_empty());
    std::env::var(var)
        .unwrap_or_default()
        .split(':')
        .filter(|e| !e.is_empty() && !appdir.as_deref().is_some_and(|a| e.starts_with(a)))
        .map(String::from)
        .collect()
}

/// A command for host programs (Python, pip). Inside an AppImage the launcher sets PYTHONHOME,
/// PYTHONPATH and LD_LIBRARY_PATH for its own bundle, which makes the system Python crash on start.
pub fn host_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    for var in ["PYTHONHOME", "PYTHONPATH", "PYTHONDONTWRITEBYTECODE", "PYTHONSTARTUP"] {
        c.env_remove(var);
    }
    c.env("PATH", host_paths("PATH").join(":"));
    match host_paths("LD_LIBRARY_PATH") {
        ld if ld.is_empty() => c.env_remove("LD_LIBRARY_PATH"),
        ld => c.env("LD_LIBRARY_PATH", ld.join(":")),
    };
    c
}

pub fn which(name: &str) -> Option<PathBuf> {
    host_paths("PATH").into_iter().map(|d| Path::new(&d).join(name)).find(|p| p.is_file())
}

pub fn has_nvidia_driver() -> bool {
    Path::new("/proc/driver/nvidia/version").exists() || which("nvidia-smi").is_some()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPython {
    pub path: String,
    pub version: String,
}

/// Version of an interpreter that can create venvs, or None.
async fn python_version(exe: &Path) -> Option<(u32, u32, String)> {
    let out = host_command(exe)
        .args(["-c", "import sys, venv, ensurepip; print('%d.%d.%d' % sys.version_info[:3])"])
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let mut it = v.split('.').map(|p| p.parse::<u32>().ok());
    Some((it.next()??, it.next()??, v))
}

pub async fn find_python(custom: &str) -> Option<SystemPython> {
    let mut candidates: Vec<PathBuf> = vec![];
    if !custom.trim().is_empty() {
        candidates.push(PathBuf::from(custom.trim()));
    }
    // Prefer well-trodden versions first; the plain `python3` comes last.
    for minor in [12, 13, 11, 10, 14, 9] {
        candidates.extend(which(&format!("python3.{minor}")));
    }
    candidates.extend(which("python3"));
    for exe in candidates {
        if let Some((major, minor, version)) = python_version(&exe).await
            && major == 3 && (MIN_MINOR..=MAX_MINOR).contains(&minor) {
                return Some(SystemPython { path: exe.to_string_lossy().into_owned(), version });
            }
    }
    None
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Probe {
    python: Option<String>,
    faster_whisper: Option<String>,
    ctranslate2: Option<String>,
    import_error: Option<String>,
    #[serde(default)]
    cuda_devices: u32,
    gpu_name: Option<String>,
    vram_gb: Option<f64>,
    #[serde(default)]
    cached_models: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// The venv exists and faster-whisper imports.
    pub ready: bool,
    pub venv: bool,
    pub system_python: Option<SystemPython>,
    pub python: Option<String>,
    pub faster_whisper: Option<String>,
    pub ctranslate2: Option<String>,
    pub nvidia_driver: bool,
    pub cuda: bool,
    pub gpu_name: Option<String>,
    pub vram_gb: Option<f64>,
    pub cached_models: Vec<String>,
    pub error: Option<String>,
    pub data_dir: String,
}

pub async fn status(paths: &Paths, custom_python: &str) -> EngineStatus {
    let mut st = EngineStatus {
        nvidia_driver: has_nvidia_driver(),
        data_dir: paths.data.to_string_lossy().into_owned(),
        system_python: find_python(custom_python).await,
        ..Default::default()
    };
    let py = paths.python();
    st.venv = py.exists();
    if !st.venv {
        return st;
    }
    let out = host_command(&py)
        .arg(&paths.script)
        .arg("--probe")
        .envs(paths.engine_env())
        .stdin(Stdio::null())
        .output()
        .await;
    match out {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            match stdout.lines().last().map(serde_json::from_str::<Probe>) {
                Some(Ok(p)) => {
                    st.ready = p.faster_whisper.is_some();
                    st.python = p.python;
                    st.faster_whisper = p.faster_whisper;
                    st.ctranslate2 = p.ctranslate2;
                    st.cuda = p.cuda_devices > 0;
                    st.gpu_name = p.gpu_name;
                    st.vram_gb = p.vram_gb;
                    st.cached_models = p.cached_models;
                    st.error = p.import_error;
                }
                _ => st.error = Some(tail(&String::from_utf8_lossy(&o.stderr), 6)),
            }
        }
        Err(e) => st.error = Some(format!("Couldn't run the engine's Python: {e}")),
    }
    st
}

fn tail(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupEvent {
    pub step: u8,
    pub steps: u8,
    pub label: String,
    pub line: Option<String>,
}

/// Runs a command, forwarding each output line. Errors carry the last lines of output.
async fn run_streaming(mut cmd: Command, mut on_line: impl FnMut(String)) -> Result<()> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = cmd.spawn()?;
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    for reader in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        });
    }
    drop(tx);
    let mut recent: VecDeque<String> = VecDeque::new();
    while let Some(line) = rx.recv().await {
        if line.trim().is_empty() {
            continue;
        }
        if recent.len() == 12 {
            recent.pop_front();
        }
        recent.push_back(line.clone());
        on_line(line);
    }
    let status = child.wait().await?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::msg(Vec::from(recent).join("\n")))
    }
}

/// Creates the private venv and installs faster-whisper (plus CUDA libraries when an NVIDIA driver is present).
pub async fn install(paths: &Paths, custom_python: &str, mut emit: impl FnMut(SetupEvent)) -> Result<()> {
    let cuda = has_nvidia_driver();
    let steps: u8 = if cuda { 4 } else { 3 };
    let mut report = |step: u8, label: &str, line: Option<String>| emit(SetupEvent { step, steps, label: label.into(), line });

    report(1, "Creating Python environment", None);
    let venv_ok = paths.python().exists() && python_version(&paths.python()).await.is_some();
    if !venv_ok {
        let Some(sys_py) = find_python(custom_python).await else {
            return Err(Error::msg(
                "No usable Python 3.9–3.14 found. Install it with your package manager (Arch: `sudo pacman -S python`, Debian/Ubuntu: `sudo apt install python3 python3-venv`, Fedora: `sudo dnf install python3`), then try again.",
            ));
        };
        report(1, "Creating Python environment", Some(format!("Using Python {} at {}", sys_py.version, sys_py.path)));
        let _ = std::fs::remove_dir_all(&paths.venv);
        std::fs::create_dir_all(&paths.data)?;
        let mut c = host_command(&sys_py.path);
        c.args(["-m", "venv"]).arg(&paths.venv);
        run_streaming(c, |l| report(1, "Creating Python environment", Some(l))).await?;
    }

    let pip = |args: &[&str]| {
        let mut c = host_command(paths.python());
        c.args(["-m", "pip", "install", "--progress-bar", "off", "--upgrade"]).args(args).envs(paths.engine_env());
        c
    };

    report(2, "Updating pip", None);
    run_streaming(pip(&["pip"]), |l| report(2, "Updating pip", Some(l))).await?;

    report(3, "Installing faster-whisper", None);
    // PyAV 19 dropped an argument faster-whisper 1.2 still passes (the worker also shims it).
    run_streaming(pip(&["faster-whisper", "av<19"]), |l| report(3, "Installing faster-whisper", Some(l))).await?;

    if cuda {
        let label = "Installing CUDA libraries (~1 GB)";
        report(4, label, None);
        run_streaming(pip(&["nvidia-cublas-cu12", "nvidia-cudnn-cu12>=9,<10"]), |l| report(4, label, Some(l))).await?;
    }
    Ok(())
}

pub fn remove_venv(paths: &Paths) -> Result<()> {
    if paths.venv.exists() {
        std::fs::remove_dir_all(&paths.venv)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_last_nonempty_lines() {
        assert_eq!(tail("a\n\nb\nc\n", 2), "b\nc");
    }

    #[test]
    fn cuda_dirs_found_in_venv() {
        let dir = tempfile::tempdir().unwrap();
        let p = Paths::new(dir.path().into(), dir.path().into(), None, dir.path().into());
        let lib = p.venv.join("lib/python3.12/site-packages/nvidia/cublas/lib");
        std::fs::create_dir_all(&lib).unwrap();
        assert_eq!(p.cuda_lib_dirs(), vec![lib.clone()]);
        assert!(p.engine_env()[0].1.starts_with(&*lib.to_string_lossy()));
    }
}
