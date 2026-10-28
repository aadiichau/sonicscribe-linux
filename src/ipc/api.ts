import { Channel, invoke } from "@tauri-apps/api/core";
import type { Added, AppInfo, EngineStatus, ExportFormat, Record, Segment, SetupEvent, Settings, Snapshot, Summary, UiEvent } from "./types";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Commands reject with a plain message string. */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : String((e as Error)?.message ?? e);
}

export const api = {
  subscribe(onEvent: (e: UiEvent) => void) {
    const ch = new Channel<UiEvent>();
    ch.onmessage = onEvent;
    return invoke<Snapshot>("subscribe", { channel: ch });
  },
  addFiles: (paths: string[]) => invoke<Added>("add_files", { paths }),
  pickFiles: () => invoke<Added>("pick_files"),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  retryJob: (id: string) => invoke<void>("retry_job", { id }),
  removeJobs: (ids: string[]) => invoke<void>("remove_jobs", { ids }),
  clearFinished: () => invoke<void>("clear_finished"),
  setPaused: (paused: boolean) => invoke<void>("set_paused", { paused }),
  transcript: (id: string) => invoke<Segment[]>("transcript", { id }),
  historyList: (query: string) => invoke<Summary[]>("history_list", { query }),
  historyGet: (id: string) => invoke<Record>("history_get", { id }),
  historyRename: (id: string, name: string) => invoke<Summary>("history_rename", { id, name }),
  historyDelete: (id: string) => invoke<void>("history_delete", { id }),
  exportTranscript: (id: string, format: ExportFormat) => invoke<string | null>("export_transcript", { id, format }),
  exportAll: (id: string, formats: ExportFormat[]) => invoke<string[]>("export_all", { id, formats }),
  copyTranscript: (id: string, format: ExportFormat) => invoke<number>("copy_transcript", { id, format }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openPath: (path: string, reveal: boolean) => invoke<void>("open_path", { path, reveal }),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<Settings>("set_settings", { settings }),
  chooseOutputDir: () => invoke<Settings | null>("choose_output_dir"),
  choosePython: () => invoke<Settings | null>("choose_python"),
  engineStatus: () => invoke<EngineStatus>("engine_status"),
  engineInstall(fresh: boolean, onProgress: (e: SetupEvent) => void) {
    const ch = new Channel<SetupEvent>();
    ch.onmessage = onProgress;
    return invoke<EngineStatus>("engine_install", { onProgress: ch, fresh });
  },
  engineRestart: () => invoke<void>("engine_restart"),
  appInfo: () => invoke<AppInfo>("app_info"),
};
