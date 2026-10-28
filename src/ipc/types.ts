// Mirrors the Rust types in src-tauri/src (serde camelCase).

export type JobState = "queued" | "loading" | "downloading" | "transcribing" | "done" | "failed" | "cancelled";

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Job {
  id: string;
  path: string;
  name: string;
  size: number;
  model: string;
  language: string;
  state: JobState;
  stage: string;
  position: number;
  duration: number;
  speed: number;
  bytes: number;
  total: number;
  detectedLanguage: string | null;
  segmentCount: number;
  error: string | null;
  hint: string | null;
  detail: string | null;
  device: string | null;
  computeType: string | null;
  elapsed: number | null;
  addedAt: number;
  finishedAt: number | null;
  exported: string[];
}

export type UiEvent =
  | { type: "job"; job: Job }
  | { type: "removed"; id: string }
  | { type: "segment"; id: string; segment: Segment }
  | { type: "paused"; paused: boolean };

export interface Snapshot {
  jobs: Job[];
  paused: boolean;
}

export interface Added {
  jobs: Job[];
  skipped: number;
}

export interface Summary {
  id: string;
  name: string;
  path: string;
  model: string;
  language: string | null;
  duration: number;
  elapsed: number;
  device: string | null;
  createdAt: number;
  segmentCount: number;
  words: number;
  preview: string;
}

export interface Record {
  id: string;
  name: string;
  path: string;
  model: string;
  language: string | null;
  duration: number;
  elapsed: number;
  device: string | null;
  createdAt: number;
  segments: Segment[];
}

export type ExportFormat = "txt" | "timestamps" | "srt" | "vtt" | "json";

export interface Settings {
  model: string;
  language: string;
  device: "auto" | "cuda" | "cpu";
  beamSize: number;
  vad: boolean;
  initialPrompt: string;
  outputDir: string;
  autoExport: ExportFormat[];
  notifications: boolean;
  nativeTitleBar: boolean;
  pythonPath: string;
}

export interface EngineStatus {
  ready: boolean;
  venv: boolean;
  systemPython: { path: string; version: string } | null;
  python: string | null;
  fasterWhisper: string | null;
  ctranslate2: string | null;
  nvidiaDriver: boolean;
  cuda: boolean;
  gpuName: string | null;
  vramGb: number | null;
  cachedModels: string[];
  error: string | null;
  dataDir: string;
}

export interface SetupEvent {
  step: number;
  steps: number;
  label: string;
  line: string | null;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  historyCount: number;
}
