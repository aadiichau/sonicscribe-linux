import { lazy, Suspense, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, errorText, isTauri } from "../ipc/api";
import { useApp } from "../state/store";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { Toasts } from "./Toasts";
import { TranscribeView } from "../features/transcribe/TranscribeView";

const HistoryView = lazy(() => import("../features/history/HistoryView"));
const SettingsView = lazy(() => import("../features/settings/SettingsView"));

export function App() {
  const view = useApp((s) => s.view);
  const [dragging, setDragging] = useState(false);
  const [backendMissing] = useState(() => !isTauri());

  useEffect(() => {
    if (backendMissing) return;
    const { applyEvent, loadSnapshot, setSettings, refreshEngine } = useApp.getState();
    api.subscribe(applyEvent).then(loadSnapshot);
    api.getSettings().then(setSettings);
    refreshEngine().catch(() => {});
  }, [backendMissing]);

  // Files dropped from a file manager arrive as native paths through Tauri, not as DOM drops.
  useEffect(() => {
    if (backendMissing) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setDragging(true);
      else if (p.type === "leave") setDragging(false);
      else if (p.type === "drop") {
        setDragging(false);
        const s = useApp.getState();
        s.setView("transcribe");
        api.addFiles(p.paths).then(s.added, (err) => s.toast({ tone: "err", title: "Couldn't add files", body: errorText(err) }));
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [backendMissing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === "1") s.setView("transcribe");
        else if (e.key === "2") s.setView("history");
        else if (e.key === ",") s.setView("settings");
        else if (e.key.toLowerCase() === "o") {
          s.setView("transcribe");
          api.pickFiles().then(s.added, () => {});
        } else if (e.key.toLowerCase() === "f") {
          s.setView("history");
          setTimeout(() => document.getElementById("history-search")?.focus(), 50);
        } else return;
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid h-full grid-rows-[var(--titlebar-h)_minmax(0,1fr)]">
      <TitleBar />
      <div className="grid min-h-0 grid-cols-[var(--sidebar-w)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        <Sidebar />
        <main className="relative min-h-0 min-w-0" key={view}>
          {backendMissing ? (
            <div className="p-6 text-fg-2">SonicScribe's engine isn't connected. Start the app with <span className="mono">npm run tauri dev</span>.</div>
          ) : (
            <Suspense fallback={null}>
              {view === "transcribe" && <TranscribeView />}
              {view === "history" && <HistoryView />}
              {view === "settings" && <SettingsView />}
            </Suspense>
          )}
          {dragging && (
            <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-md border border-dashed border-[var(--amber-line)] bg-[rgb(229_162_60/0.04)]">
              <span className="chip chip-amber">Drop to transcribe</span>
            </div>
          )}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
