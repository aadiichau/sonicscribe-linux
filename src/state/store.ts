import { create } from "zustand";
import { api, errorText } from "../ipc/api";
import type { Added, EngineStatus, Job, Segment, Settings, Snapshot, UiEvent } from "../ipc/types";

export type View = "transcribe" | "history" | "settings";

export interface Toast {
  id: number;
  tone: "ok" | "err" | "info";
  title: string;
  body?: string;
}

export interface SetupRun {
  running: boolean;
  step: number;
  steps: number;
  label: string;
  lines: string[];
  error: string | null;
}

export const isActive = (j: Job) => j.state === "loading" || j.state === "downloading" || j.state === "transcribing";
export const isFinished = (j: Job) => j.state === "done" || j.state === "failed" || j.state === "cancelled";

interface AppState {
  view: View;
  setView: (v: View) => void;

  jobs: Record<string, Job>;
  order: string[];
  paused: boolean;
  /** Transcript segments per job, filled live from events or fetched on demand. */
  segments: Record<string, Segment[]>;
  selected: string | null;
  select: (id: string | null) => void;
  loadSnapshot: (s: Snapshot) => void;
  applyEvent: (e: UiEvent) => void;
  added: (a: Added) => void;

  settings: Settings | null;
  setSettings: (s: Settings) => void;
  saveSettings: (patch: Partial<Settings>) => void;

  engine: EngineStatus | null;
  refreshEngine: () => Promise<void>;
  setup: SetupRun | null;
  install: (fresh?: boolean) => Promise<void>;

  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  view: "transcribe",
  setView: (view) => set({ view }),

  jobs: {},
  order: [],
  paused: false,
  segments: {},
  selected: null,
  select: (id) => {
    set({ selected: id });
    if (id && !get().segments[id]) {
      const job = get().jobs[id];
      if (job && job.state !== "queued") {
        api.transcript(id).then(
          (segs) => set((s) => ({ segments: { ...s.segments, [id]: segs } })),
          () => {},
        );
      }
    }
  },
  loadSnapshot: ({ jobs, paused }) => {
    set({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])), order: jobs.map((j) => j.id), paused });
    const active = jobs.find(isActive) ?? jobs[jobs.length - 1];
    if (active) get().select(active.id);
  },
  applyEvent: (e) => {
    switch (e.type) {
      case "job": {
        const prev = get().jobs[e.job.id];
        set((s) => ({ jobs: { ...s.jobs, [e.job.id]: e.job }, order: prev ? s.order : [...s.order, e.job.id] }));
        if (prev && prev.state !== "queued" && e.job.state === "queued") {
          // Retried: the old transcript is gone.
          set((s) => ({ segments: { ...s.segments, [e.job.id]: [] } }));
        }
        // Follow the job that just started unless the user is reading something unfinished.
        const sel = get().selected ? get().jobs[get().selected!] : null;
        if (prev?.state === "queued" && isActive(e.job) && (!sel || isFinished(sel) || sel.state === "queued")) {
          set((s) => ({ selected: e.job.id, segments: { ...s.segments, [e.job.id]: [] } }));
        }
        if (prev && prev.state !== "done" && e.job.state === "done" && e.job.exported.length) {
          get().toast({ tone: "ok", title: `Saved ${e.job.exported.length} export${e.job.exported.length > 1 ? "s" : ""}`, body: e.job.exported.join("\n") });
        }
        break;
      }
      case "removed":
        set((s) => {
          const { [e.id]: _, ...jobs } = s.jobs;
          const { [e.id]: __, ...segments } = s.segments;
          return { jobs, segments, order: s.order.filter((x) => x !== e.id), selected: s.selected === e.id ? null : s.selected };
        });
        break;
      case "segment":
        set((s) => ({ segments: { ...s.segments, [e.id]: [...(s.segments[e.id] ?? []), e.segment] } }));
        break;
      case "paused":
        set({ paused: e.paused });
        break;
    }
  },
  added: ({ jobs, skipped }) => {
    if (jobs.length && !get().selected) get().select(jobs[0].id);
    if (skipped > 0) {
      get().toast({
        tone: "info",
        title: `Skipped ${skipped} file${skipped > 1 ? "s" : ""}`,
        body: "Only audio and video files are added, and each file is queued once.",
      });
    }
  },

  settings: null,
  setSettings: (settings) => set({ settings }),
  saveSettings: (patch) => {
    const cur = get().settings;
    if (!cur) return;
    set({ settings: { ...cur, ...patch } });
    api.setSettings({ ...cur, ...patch }).then(
      (settings) => set({ settings }),
      (e) => {
        set({ settings: cur });
        get().toast({ tone: "err", title: "Couldn't save settings", body: errorText(e) });
      },
    );
  },

  engine: null,
  refreshEngine: async () => {
    const engine = await api.engineStatus();
    set({ engine });
  },
  setup: null,
  install: async (fresh = false) => {
    if (get().setup?.running) return;
    set({ setup: { running: true, step: 1, steps: 4, label: "Starting", lines: [], error: null } });
    try {
      const engine = await api.engineInstall(fresh, (ev) =>
        set((s) => ({
          setup: s.setup && {
            ...s.setup,
            step: ev.step,
            steps: ev.steps,
            label: ev.label,
            lines: ev.line ? [...s.setup.lines.slice(-199), ev.line] : s.setup.lines,
          },
        })),
      );
      set({ engine, setup: null });
      if (engine.ready) {
        get().toast({ tone: "ok", title: "Engine ready", body: engine.cuda ? `GPU: ${engine.gpuName}` : "Running on CPU." });
      } else {
        get().toast({ tone: "err", title: "The engine installed but doesn't start", body: engine.error ?? undefined });
      }
    } catch (e) {
      set((s) => ({ setup: s.setup && { ...s.setup, running: false, error: errorText(e) } }));
      get().refreshEngine().catch(() => {});
    }
  },

  toasts: [],
  toast: (t) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    if (t.tone !== "err") setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
