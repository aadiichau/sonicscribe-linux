//! Desktop integration for runs that weren't installed by a package (AppImage, `tauri dev`).
//!
//! Wayland compositors show a window's icon by matching its app id (`sonicscribe`) to
//! `sonicscribe.desktop`. Packages install that file; otherwise we write a per-user one.

use std::path::{Path, PathBuf};

const APP_ID: &str = "sonicscribe";
const MARKER: &str = "X-SonicScribe-UserIntegration=true";
const ICON: &[u8] = include_bytes!("../icons/icon.png");

fn data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
}

fn system_entry_exists() -> bool {
    let dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    // An AppImage prepends its own mount point, whose desktop file the desktop can't see.
    let appdir = std::env::var("APPDIR").ok().filter(|d| !d.is_empty());
    dirs.split(':')
        .filter(|d| !d.is_empty() && !appdir.as_deref().is_some_and(|a| d.starts_with(a)))
        .any(|d| Path::new(d).join("applications").join(format!("{APP_ID}.desktop")).exists())
}

fn entry(exec: &Path, icon: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=SonicScribe\nGenericName=Speech to Text\nComment=Transcribe audio and video locally with Whisper\n\
         Exec=\"{}\" %F\nIcon={}\nTerminal=false\nCategories=AudioVideo;Audio;Utility;\nStartupWMClass={APP_ID}\nStartupNotify=true\n\
         MimeType=audio/mpeg;audio/x-wav;audio/wav;audio/mp4;audio/x-m4a;audio/flac;audio/ogg;audio/opus;audio/aac;video/mp4;video/x-matroska;video/webm;video/quicktime;\n{MARKER}\n",
        exec.display(),
        icon.display()
    )
}

pub fn integrate() {
    if let Err(e) = try_integrate() {
        tracing::warn!("desktop integration: {e}");
    }
}

fn try_integrate() -> std::io::Result<()> {
    let Some(data) = data_home() else { return Ok(()) };
    let desktop = data.join("applications").join(format!("{APP_ID}.desktop"));
    let ours = std::fs::read_to_string(&desktop).map(|s| s.contains(MARKER)).ok();

    if system_entry_exists() {
        // A package owns the integration now; drop the per-user copy so it can't shadow it.
        if ours == Some(true) {
            std::fs::remove_file(&desktop)?;
        }
        return Ok(());
    }
    if ours == Some(false) {
        return Ok(()); // the user wrote their own entry
    }

    let exec = std::env::var_os("APPIMAGE").map(PathBuf::from).map_or_else(std::env::current_exe, Ok)?;
    let icon = data.join("icons/hicolor/512x512/apps").join(format!("{APP_ID}.png"));
    if std::fs::read(&icon).ok().as_deref() != Some(ICON) {
        std::fs::create_dir_all(icon.parent().unwrap())?;
        std::fs::write(&icon, ICON)?;
    }
    let content = entry(&exec, &icon);
    if std::fs::read_to_string(&desktop).ok().as_deref() != Some(content.as_str()) {
        std::fs::create_dir_all(desktop.parent().unwrap())?;
        std::fs::write(&desktop, content)?;
        tracing::info!("registered {}", desktop.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_quotes_exec_and_marks_ownership() {
        let e = entry(Path::new("/opt/My Apps/SonicScribe.AppImage"), Path::new("/i/s.png"));
        assert!(e.contains("Exec=\"/opt/My Apps/SonicScribe.AppImage\" %F"));
        assert!(e.contains("StartupWMClass=sonicscribe"));
        assert!(e.ends_with(&format!("{MARKER}\n")));
    }
}
