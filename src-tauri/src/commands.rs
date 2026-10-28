use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::engine::env::{self, EngineStatus, SetupEvent};
use crate::engine::jobs::{write_export, Job, Msg, Snapshot, UiEvent};
use crate::error::{Error, Result};
use crate::export::{self, Segment};
use crate::history::{Record, Summary};
use crate::settings::Settings;
use crate::Ctx;

pub const MEDIA_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "m4a", "flac", "ogg", "oga", "opus", "aac", "wma", "aiff", "aif", "amr", "mp4", "m4v", "mkv", "webm", "mov", "avi",
    "wmv", "flv", "mpg", "mpeg", "ts", "3gp",
];

pub fn is_media(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| MEDIA_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Expands dropped folders one level deep and keeps media files only.
pub fn collect_media(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut out = vec![];
    for p in paths {
        if p.is_dir() {
            if let Ok(rd) = std::fs::read_dir(&p) {
                let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|f| f.is_file() && is_media(f)).collect();
                files.sort();
                out.extend(files);
            }
        } else if is_media(&p) {
            out.push(p);
        }
    }
    out
}

#[tauri::command]
pub fn subscribe(ctx: State<'_, Ctx>, channel: Channel<UiEvent>) -> Snapshot {
    ctx.jobs.subscribe(channel)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Added {
    jobs: Vec<Job>,
    skipped: usize,
}

fn add(ctx: &Ctx, paths: Vec<PathBuf>) -> Added {
    let not_media = paths.iter().filter(|p| !p.is_dir() && !is_media(p)).count();
    let media = collect_media(paths);
    let considered = media.len();
    let s = ctx.settings.get();
    let jobs = ctx.jobs.add(media, &s.model, &s.language);
    // Non-media files plus duplicates of files already in the queue.
    Added { skipped: not_media + (considered - jobs.len()), jobs }
}

#[tauri::command]
pub fn add_files(ctx: State<'_, Ctx>, paths: Vec<String>) -> Added {
    add(&ctx, paths.into_iter().map(PathBuf::from).collect())
}

#[tauri::command]
pub async fn pick_files(app: AppHandle, ctx: State<'_, Ctx>) -> Result<Added> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Add audio or video").add_filter("Audio and video", MEDIA_EXTENSIONS).blocking_pick_files()
    })
    .await
    .map_err(|e| Error::msg(e.to_string()))?;
    let paths = picked.unwrap_or_default().into_iter().filter_map(|f| f.into_path().ok()).collect();
    Ok(add(&ctx, paths))
}

#[tauri::command]
pub fn cancel_job(ctx: State<'_, Ctx>, id: String) {
    ctx.jobs.cancel(&id);
}

#[tauri::command]
pub fn retry_job(ctx: State<'_, Ctx>, id: String) {
    let s = ctx.settings.get();
    ctx.jobs.retry(&id, &s.model, &s.language);
}

#[tauri::command]
pub fn remove_jobs(ctx: State<'_, Ctx>, ids: Vec<String>) {
    ctx.jobs.remove(&ids);
}

#[tauri::command]
pub fn clear_finished(ctx: State<'_, Ctx>) {
    ctx.jobs.clear_finished();
}

#[tauri::command]
pub fn set_paused(ctx: State<'_, Ctx>, paused: bool) {
    ctx.jobs.set_paused(paused);
}

fn segments_for(ctx: &Ctx, id: &str) -> Result<Vec<Segment>> {
    match ctx.jobs.segments(id) {
        Some(s) => Ok(s),
        None => Ok(ctx.history.get(id)?.segments),
    }
}

#[tauri::command]
pub fn transcript(ctx: State<'_, Ctx>, id: String) -> Result<Vec<Segment>> {
    segments_for(&ctx, &id)
}

#[tauri::command]
pub fn history_list(ctx: State<'_, Ctx>, query: String) -> Vec<Summary> {
    ctx.history.list(&query)
}

#[tauri::command]
pub fn history_get(ctx: State<'_, Ctx>, id: String) -> Result<Record> {
    ctx.history.get(&id)
}

#[tauri::command]
pub fn history_rename(ctx: State<'_, Ctx>, id: String, name: String) -> Result<Summary> {
    ctx.history.rename(&id, &name)
}

#[tauri::command]
pub fn history_delete(ctx: State<'_, Ctx>, id: String) -> Result<()> {
    ctx.history.delete(&id)
}

fn display_stem(ctx: &Ctx, id: &str) -> String {
    let name = ctx.jobs.get(id).map(|j| j.name).or_else(|| ctx.history.get(id).ok().map(|r| r.name)).unwrap_or_default();
    Path::new(&name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(name)
}

/// Asks where to save, then writes the export. Returns the path, or None if the dialog was dismissed.
#[tauri::command]
pub async fn export_transcript(app: AppHandle, ctx: State<'_, Ctx>, id: String, format: String) -> Result<Option<String>> {
    let segments = segments_for(&ctx, &id)?;
    let s = ctx.settings.get();
    let _ = std::fs::create_dir_all(&s.output_dir);
    let file_name = format!("{}{}", export::safe_stem(&display_stem(&ctx, &id)), export::suffix(&format));
    let ext = export::extension(&format);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Export transcript").set_directory(&s.output_dir).set_file_name(&file_name).add_filter(ext.to_uppercase(), &[ext]).blocking_save_file()
    })
    .await
    .map_err(|e| Error::msg(e.to_string()))?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    std::fs::write(&path, export::render(&format, &segments))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Writes every format at once into the output folder.
#[tauri::command]
pub fn export_all(ctx: State<'_, Ctx>, id: String, formats: Vec<String>) -> Result<Vec<String>> {
    let segments = segments_for(&ctx, &id)?;
    let s = ctx.settings.get();
    let stem = display_stem(&ctx, &id);
    formats.iter().map(|f| Ok(write_export(Path::new(&s.output_dir), &stem, f, &segments)?.to_string_lossy().into_owned())).collect()
}

#[tauri::command]
pub fn copy_transcript(app: AppHandle, ctx: State<'_, Ctx>, id: String, format: String) -> Result<usize> {
    let text = export::render(&format, &segments_for(&ctx, &id)?);
    app.clipboard().write_text(text.trim_end().to_string()).map_err(|e| Error::msg(e.to_string()))?;
    Ok(text.split_whitespace().count())
}

#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> Result<()> {
    app.clipboard().write_text(text).map_err(|e| Error::msg(e.to_string()))
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<()> {
    if !url.starts_with("https://") {
        return Err(Error::msg("Only https links can be opened."));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| Error::msg(e.to_string()))
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String, reveal: bool) -> Result<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(Error::msg(format!("{path} no longer exists.")));
    }
    let r = if reveal { app.opener().reveal_item_in_dir(&p) } else { app.opener().open_path(path, None::<&str>) };
    r.map_err(|e| Error::msg(e.to_string()))
}

#[tauri::command]
pub fn get_settings(ctx: State<'_, Ctx>) -> Settings {
    ctx.settings.get()
}

#[tauri::command]
pub fn set_settings(ctx: State<'_, Ctx>, settings: Settings) -> Result<Settings> {
    ctx.settings.set(settings)
}

#[tauri::command]
pub async fn choose_output_dir(app: AppHandle, ctx: State<'_, Ctx>) -> Result<Option<Settings>> {
    let current = ctx.settings.get().output_dir;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_title("Output folder").set_directory(current).blocking_pick_folder())
        .await
        .map_err(|e| Error::msg(e.to_string()))?;
    let Some(dir) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let mut s = ctx.settings.get();
    s.output_dir = dir.to_string_lossy().into_owned();
    Ok(Some(ctx.settings.set(s)?))
}

#[tauri::command]
pub async fn choose_python(app: AppHandle, ctx: State<'_, Ctx>) -> Result<Option<Settings>> {
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_title("Python interpreter").set_directory("/usr/bin").blocking_pick_file())
        .await
        .map_err(|e| Error::msg(e.to_string()))?;
    let Some(py) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let mut s = ctx.settings.get();
    s.python_path = py.to_string_lossy().into_owned();
    Ok(Some(ctx.settings.set(s)?))
}

#[tauri::command]
pub async fn engine_status(ctx: State<'_, Ctx>) -> Result<EngineStatus> {
    Ok(env::status(&ctx.paths, &ctx.settings.get().python_path).await)
}

#[tauri::command]
pub async fn engine_install(ctx: State<'_, Ctx>, on_progress: Channel<SetupEvent>, fresh: bool) -> Result<EngineStatus> {
    if ctx.installing.swap(true, Ordering::SeqCst) {
        return Err(Error::msg("Setup is already running."));
    }
    // The worker holds the venv's Python open; stop it before touching the environment.
    ctx.jobs.send(Msg::Restart);
    let result = async {
        if fresh {
            env::remove_venv(&ctx.paths)?;
        }
        env::install(&ctx.paths, &ctx.settings.get().python_path, |e| {
            let _ = on_progress.send(e);
        })
        .await
    }
    .await;
    ctx.installing.store(false, Ordering::SeqCst);
    result?;
    let status = env::status(&ctx.paths, &ctx.settings.get().python_path).await;
    if status.ready {
        ctx.jobs.send(Msg::Kick);
    }
    Ok(status)
}

#[tauri::command]
pub fn engine_restart(ctx: State<'_, Ctx>) {
    ctx.jobs.send(Msg::Restart);
    ctx.jobs.send(Msg::Kick);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    history_count: usize,
}

#[tauri::command]
pub fn app_info(app: AppHandle, ctx: State<'_, Ctx>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: ctx.paths.data.to_string_lossy().into_owned(),
        history_count: ctx.history.count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_filter() {
        assert!(is_media(Path::new("/a/B.MP3")));
        assert!(is_media(Path::new("clip.webm")));
        assert!(!is_media(Path::new("notes.txt")));
        let dir = tempfile::tempdir().unwrap();
        for f in ["b.wav", "a.mkv", "c.pdf"] {
            std::fs::write(dir.path().join(f), b"").unwrap();
        }
        let got = collect_media([dir.path().to_path_buf()]);
        assert_eq!(got.iter().map(|p| p.file_name().unwrap().to_str().unwrap()).collect::<Vec<_>>(), ["a.mkv", "b.wav"]);
    }
}
