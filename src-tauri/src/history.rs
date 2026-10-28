use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::export::{plain_text, Segment};

/// A finished transcript as stored on disk, one JSON file per record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub name: String,
    pub path: String,
    pub model: String,
    pub language: Option<String>,
    pub duration: f64,
    pub elapsed: f64,
    pub device: Option<String>,
    pub created_at: i64,
    pub segments: Vec<Segment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub model: String,
    pub language: Option<String>,
    pub duration: f64,
    pub elapsed: f64,
    pub device: Option<String>,
    pub created_at: i64,
    pub segment_count: usize,
    pub words: usize,
    pub preview: String,
}

struct Entry {
    summary: Summary,
    haystack: String,
}

impl Entry {
    fn from_record(r: &Record) -> Self {
        let text = plain_text(&r.segments);
        let preview: String = text.chars().take(180).collect();
        Entry {
            haystack: format!("{} {}", r.name, text).to_lowercase(),
            summary: Summary {
                id: r.id.clone(),
                name: r.name.clone(),
                path: r.path.clone(),
                model: r.model.clone(),
                language: r.language.clone(),
                duration: r.duration,
                elapsed: r.elapsed,
                device: r.device.clone(),
                created_at: r.created_at,
                segment_count: r.segments.len(),
                words: text.split_whitespace().count(),
                preview,
            },
        }
    }
}

pub struct History {
    dir: PathBuf,
    entries: Mutex<Vec<Entry>>,
}

impl History {
    pub fn load(dir: PathBuf) -> Self {
        let mut entries = vec![];
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for f in rd.flatten() {
                let p = f.path();
                if p.extension().is_some_and(|e| e == "json") {
                    match std::fs::read(&p).map_err(Error::from).and_then(|b| Ok(serde_json::from_slice::<Record>(&b)?)) {
                        Ok(r) => entries.push(Entry::from_record(&r)),
                        Err(e) => tracing::warn!("skipping history file {}: {e}", p.display()),
                    }
                }
            }
        }
        entries.sort_by_key(|e| std::cmp::Reverse(e.summary.created_at));
        Self { dir, entries: Mutex::new(entries) }
    }

    fn file(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(Error::msg("Invalid transcript id"));
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    pub fn save(&self, record: &Record) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let path = self.file(&record.id)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(record)?)?;
        std::fs::rename(&tmp, &path)?;
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|e| e.summary.id != record.id);
        entries.insert(0, Entry::from_record(record));
        Ok(())
    }

    /// Newest first. Every whitespace-separated term must appear in the name or text.
    pub fn list(&self, query: &str) -> Vec<Summary> {
        let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        self.entries
            .lock()
            .unwrap()
            .iter()
            .filter(|e| terms.iter().all(|t| e.haystack.contains(t)))
            .map(|e| e.summary.clone())
            .collect()
    }

    pub fn get(&self, id: &str) -> Result<Record> {
        let bytes = std::fs::read(self.file(id)?).map_err(|_| Error::msg("This transcript is no longer in history."))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<Summary> {
        let mut r = self.get(id)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::msg("The name can't be empty."));
        }
        r.name = name.to_string();
        self.save(&r)?;
        Ok(Entry::from_record(&r).summary)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let path = self.file(id)?;
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        self.entries.lock().unwrap().retain(|e| e.summary.id != id);
        Ok(())
    }

    pub fn count(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(id: &str, at: i64, text: &str) -> Record {
        Record {
            id: id.into(),
            name: format!("{id}.mp3"),
            path: format!("/m/{id}.mp3"),
            model: "small".into(),
            language: Some("en".into()),
            duration: 10.0,
            elapsed: 2.0,
            device: None,
            created_at: at,
            segments: vec![Segment { start: 0.0, end: 1.0, text: text.into() }],
        }
    }

    #[test]
    fn save_search_reload_delete() {
        let dir = tempfile::tempdir().unwrap();
        let h = History::load(dir.path().into());
        h.save(&rec("a1", 1, "The quick brown fox")).unwrap();
        h.save(&rec("b2", 2, "Lazy dog sleeps")).unwrap();
        assert_eq!(h.list("").iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["b2", "a1"]);
        assert_eq!(h.list("QUICK fox").len(), 1);
        assert_eq!(h.list("b2.mp3")[0].id, "b2");

        let again = History::load(dir.path().into());
        assert_eq!(again.count(), 2);
        again.delete("a1").unwrap();
        assert!(again.get("a1").is_err());
        assert!(again.file("../etc").is_err());
    }
}
