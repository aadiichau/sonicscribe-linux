use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::error::Result;

pub const MODELS: &[&str] = &["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"];
pub const EXPORT_FORMATS: &[&str] = &["txt", "timestamps", "srt", "vtt", "json"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub model: String,
    pub language: String,
    /// "auto" | "cuda" | "cpu"
    pub device: String,
    pub beam_size: u8,
    pub vad: bool,
    pub initial_prompt: String,
    pub output_dir: String,
    /// Formats written to `output_dir` automatically when a job finishes.
    pub auto_export: Vec<String>,
    pub notifications: bool,
    pub native_title_bar: bool,
    /// Interpreter used to create the engine's venv. Empty = auto-detect.
    pub python_path: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            model: "large-v3-turbo".into(),
            language: "auto".into(),
            device: "auto".into(),
            beam_size: 5,
            vad: true,
            initial_prompt: String::new(),
            output_dir: String::new(),
            auto_export: vec![],
            notifications: true,
            native_title_bar: false,
            python_path: String::new(),
        }
    }
}

impl Settings {
    fn sanitized(mut self, default_output: &Path) -> Self {
        if !MODELS.contains(&self.model.as_str()) {
            self.model = Settings::default().model;
        }
        if !["auto", "cuda", "cpu"].contains(&self.device.as_str()) {
            self.device = "auto".into();
        }
        self.beam_size = self.beam_size.clamp(1, 10);
        if self.language.trim().is_empty() {
            self.language = "auto".into();
        }
        if self.output_dir.trim().is_empty() {
            self.output_dir = default_output.to_string_lossy().into_owned();
        }
        self.auto_export.retain(|f| EXPORT_FORMATS.contains(&f.as_str()));
        self.auto_export.dedup();
        self
    }
}

pub struct SettingsStore {
    path: PathBuf,
    default_output: PathBuf,
    inner: RwLock<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf, default_output: PathBuf) -> Self {
        let loaded = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default()
            .sanitized(&default_output);
        Self { path, default_output, inner: RwLock::new(loaded) }
    }

    pub fn get(&self) -> Settings {
        self.inner.read().unwrap().clone()
    }

    pub fn set(&self, next: Settings) -> Result<Settings> {
        let next = next.sanitized(&self.default_output);
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&next)?)?;
        std::fs::rename(&tmp, &self.path)?;
        *self.inner.write().unwrap() = next.clone();
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_bad_values() {
        let s = Settings { model: "huge".into(), device: "tpu".into(), beam_size: 0, auto_export: vec!["srt".into(), "pdf".into()], ..Default::default() }
            .sanitized(Path::new("/out"));
        assert_eq!(s.model, "large-v3-turbo");
        assert_eq!(s.device, "auto");
        assert_eq!(s.beam_size, 1);
        assert_eq!(s.output_dir, "/out");
        assert_eq!(s.auto_export, vec!["srt".to_string()]);
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join("s.json"), dir.path().into());
        let mut s = store.get();
        s.model = "small".into();
        store.set(s).unwrap();
        let again = SettingsStore::load(dir.path().join("s.json"), dir.path().into());
        assert_eq!(again.get().model, "small");
    }
}
