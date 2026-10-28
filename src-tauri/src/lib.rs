mod commands;
mod desktop;
mod engine;
mod error;
mod export;
mod history;
mod settings;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{Manager, RunEvent};

use engine::env::Paths;
use engine::jobs::{Jobs, Msg};
use history::History;
use settings::SettingsStore;

/// Shared application state.
pub struct Ctx {
    pub paths: Paths,
    pub settings: SettingsStore,
    pub history: History,
    pub jobs: Arc<Jobs>,
    pub installing: AtomicBool,
}

/// Media files passed on the command line (e.g. "Open with SonicScribe" in a file manager).
fn files_from_args(args: &[String], cwd: &str) -> Vec<PathBuf> {
    let paths = args.iter().filter(|a| !a.starts_with('-')).map(|a| {
        let a = a.strip_prefix("file://").unwrap_or(a);
        let p = PathBuf::from(a);
        if p.is_absolute() { p } else { PathBuf::from(cwd).join(p) }
    });
    commands::collect_media(paths)
}

fn queue_files(app: &tauri::AppHandle, files: Vec<PathBuf>) {
    if !files.is_empty() {
        let ctx = app.state::<Ctx>();
        let s = ctx.settings.get();
        ctx.jobs.add(files, &s.model, &s.language);
    }
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "sonicscribe_lib=info".into()))
        .init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_files(app, files_from_args(args.get(1..).unwrap_or_default(), &cwd));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            desktop::integrate();
            let p = app.path();
            let paths = Paths::new(p.data_dir()?.join("sonicscribe"), p.config_dir()?.join("sonicscribe"), p.document_dir().ok(), p.home_dir()?);
            paths.install_script()?;
            let settings = SettingsStore::load(paths.settings.clone(), paths.default_output.clone());
            if settings.get().native_title_bar
                && let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_decorations(true);
                }
            let history = History::load(paths.history.clone());
            let (jobs, rx) = Jobs::new();
            app.manage(Ctx { paths, settings, history, jobs, installing: AtomicBool::new(false) });

            let args: Vec<String> = std::env::args().skip(1).collect();
            let cwd = std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
            queue_files(app.handle(), files_from_args(&args, &cwd));

            tauri::async_runtime::spawn(engine::jobs::run(app.handle().clone(), rx));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::subscribe,
            commands::add_files,
            commands::pick_files,
            commands::cancel_job,
            commands::retry_job,
            commands::remove_jobs,
            commands::clear_finished,
            commands::set_paused,
            commands::transcript,
            commands::history_list,
            commands::history_get,
            commands::history_rename,
            commands::history_delete,
            commands::export_transcript,
            commands::export_all,
            commands::copy_transcript,
            commands::copy_text,
            commands::open_url,
            commands::open_path,
            commands::get_settings,
            commands::set_settings,
            commands::choose_output_dir,
            commands::choose_python,
            commands::engine_status,
            commands::engine_install,
            commands::engine_restart,
            commands::app_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SonicScribe");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            app.state::<Ctx>().jobs.send(Msg::Shutdown);
        }
    });
}
