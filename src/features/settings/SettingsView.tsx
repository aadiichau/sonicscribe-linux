import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText } from "../../ipc/api";
import type { AppInfo, Settings } from "../../ipc/types";
import { Icon } from "../../icons/Icon";
import { Row, Select, Stepper, Switch } from "../../design/controls";
import { FORMATS, LANGUAGES, MODELS } from "../../lib/catalog";
import { bytes } from "../../lib/format";
import { useApp } from "../../state/store";
import { BrandMark } from "../../app/TitleBar";
import { SetupProgress } from "./EngineSetup";

const REPO = "https://github.com/aadiichau/sonicscribe-linux";

export default function SettingsView() {
  const settings = useApp((s) => s.settings);
  const { saveSettings: save, setSettings, toast } = useApp.getState();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  useEffect(() => {
    api.appInfo().then(setInfo, () => {});
  }, []);

  if (!settings) return null;
  const fail = (title: string) => (e: unknown) => toast({ tone: "err", title, body: errorText(e) });
  const pickDir = () => api.chooseOutputDir().then((s) => s && setSettings(s), fail("Couldn't change the folder"));
  const toggleExport = (f: Settings["autoExport"][number]) =>
    save({ autoExport: settings.autoExport.includes(f) ? settings.autoExport.filter((x) => x !== f) : [...settings.autoExport, f] });
  const setNative = (on: boolean) => {
    save({ nativeTitleBar: on });
    getCurrentWindow().setDecorations(on).catch(() => {});
  };

  return (
    <div className="scroll rise h-full px-6 pb-8">
      <h1 className="pt-5 pb-4 text-lg font-semibold tracking-[-0.01em]">Settings</h1>

      <div className="t-micro mb-1">Transcription</div>
      <Row label="Model" hint="Larger models are more accurate and slower. Each is downloaded once, on first use.">
        <Select label="Model" width={260} value={settings.model} onChange={(model) => save({ model })} options={MODELS.map((m) => ({ value: m.id, label: m.label, detail: m.note, tag: bytes(m.size) }))} />
      </Row>
      <Row label="Language" hint="Auto-detect listens to the first 30 seconds. Pick the language if detection guesses wrong.">
        <Select label="Language" width={260} filterable value={settings.language} onChange={(language) => save({ language })} options={LANGUAGES.map(([value, label]) => ({ value, label, tag: value === "auto" ? undefined : value }))} />
      </Row>
      <Row label="Device" hint="Auto uses an NVIDIA GPU when CUDA works and the CPU otherwise.">
        <div className="seg" role="group" aria-label="Device">
          {(["auto", "cuda", "cpu"] as const).map((d) => (
            <button key={d} aria-pressed={settings.device === d} onClick={() => save({ device: d })}>
              {d === "auto" ? "Auto" : d === "cuda" ? "GPU (CUDA)" : "CPU"}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Beam size" hint="How many candidate phrasings Whisper weighs. 5 is the standard; 1 is faster and slightly less accurate.">
        <Stepper label="beam size" value={settings.beamSize} min={1} max={10} onChange={(beamSize) => save({ beamSize })} />
      </Row>
      <Row label="Skip silence" hint="Voice detection skips long silences. Faster, and avoids made-up text in quiet parts.">
        <Switch label="Skip silence" on={settings.vad} onChange={(vad) => save({ vad })} />
      </Row>
      <Row label="Vocabulary" hint="Names, jargon or spellings to prefer, e.g. “SonicScribe, CachyOS, Kubernetes”.">
        <input
          className="field min-w-0 flex-1"
          placeholder="Optional"
          value={prompt ?? settings.initialPrompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => prompt !== null && prompt !== settings.initialPrompt && save({ initialPrompt: prompt })}
        />
      </Row>

      <div className="t-micro mt-8 mb-1">Output</div>
      <Row label="Output folder" hint="Exports are saved here. Existing files are never overwritten.">
        <span className="t-data min-w-0 flex-1 truncate text-fg-2" title={settings.outputDir}>
          {settings.outputDir}
        </span>
        <button className="btn btn-ghost" onClick={() => api.openPath(settings.outputDir, false).catch(fail("Couldn't open the folder"))}>
          Open
        </button>
        <button className="btn btn-secondary" onClick={pickDir}>
          <Icon name="folder" />
          Change
        </button>
      </Row>
      <Row label="Save automatically" hint="Formats written to the output folder as soon as a transcript is finished.">
        <div className="flex flex-wrap gap-1.5">
          {FORMATS.map((f) => {
            const on = settings.autoExport.includes(f.id);
            return (
              <button key={f.id} aria-pressed={on} title={f.label} onClick={() => toggleExport(f.id)} className={`chip h-7 px-2.5 ${on ? "chip-amber" : "hover:text-fg-1"}`}>
                {on && <Icon name="check" size={12} className="mr-1" />}
                {f.hint.split(" ")[0]}
                {f.id === "timestamps" && " ts"}
              </button>
            );
          })}
        </div>
      </Row>

      <div className="t-micro mt-8 mb-1">Behaviour</div>
      <Row label="Notifications" hint="A desktop notification when a transcript finishes or fails while SonicScribe is in the background.">
        <Switch label="Notifications" on={settings.notifications} onChange={(notifications) => save({ notifications })} />
      </Row>
      <Row label="System title bar" hint="Use your desktop's window frame instead of SonicScribe's. Helps on some Wayland compositors.">
        <Switch label="System title bar" on={settings.nativeTitleBar} onChange={setNative} />
      </Row>

      <div className="t-micro mt-8 mb-1">Engine</div>
      <EngineSection settings={settings} />

      <div className="t-micro mt-8 mb-1">About</div>
      <div className="flex items-start gap-3 border-t border-line-1 py-3.5 text-fg-2">
        <span className="mt-0.5">
          <BrandMark size={16} />
        </span>
        <div className="min-w-0">
          <div>
            SonicScribe <span className="mono">{info?.version ?? ""}</span> for Linux · Whisper on your own hardware: no account, no upload, no limits.
          </div>
          <div className="t-data mt-1 truncate text-fg-3">
            {info && `${info.historyCount} transcripts · data in ${info.dataDir}`}
          </div>
          <button className="btn btn-ghost mt-2 -ml-3" onClick={() => api.openUrl(REPO).catch(() => {})}>
            <Icon name="external" />
            Source on GitHub · MIT license
          </button>
        </div>
      </div>
    </div>
  );
}

function EngineSection({ settings }: { settings: Settings }) {
  const engine = useApp((s) => s.engine);
  const setup = useApp((s) => s.setup);
  const { install, refreshEngine, setSettings, toast } = useApp.getState();
  const [checking, setChecking] = useState(false);

  const recheck = () => {
    setChecking(true);
    refreshEngine().finally(() => setChecking(false));
  };
  const line = (name: string, value: React.ReactNode) => (
    <div className="t-data flex min-w-0 gap-3">
      <span className="w-28 shrink-0 text-fg-3">{name}</span>
      <span className="selectable min-w-0 truncate text-fg-2">{value}</span>
    </div>
  );
  const missing = <span className="text-err">not installed</span>;

  return (
    <>
      <div className="grid min-w-0 gap-1 border-t border-line-1 py-3.5">
        {line("Status", !engine ? "checking…" : engine.ready ? <span className="text-ok">Ready</span> : <span className="text-warn">{engine.venv ? "Needs repair" : "Not installed"}</span>)}
        {line("Device", !engine ? "" : engine.cuda ? `${engine.gpuName} · ${engine.vramGb} GB · CUDA` : engine.nvidiaDriver && engine.ready ? <span className="text-warn">NVIDIA driver found, but CUDA isn't usable. Repair installs the CUDA libraries.</span> : "CPU")}
        {line("Python", engine?.python ?? (engine?.systemPython ? `${engine.systemPython.version} (system, ${engine.systemPython.path})` : missing))}
        {line("faster-whisper", engine?.fasterWhisper ?? missing)}
        {line("CTranslate2", engine?.ctranslate2 ?? missing)}
        {line("Models on disk", engine?.cachedModels.length ? engine.cachedModels.join(", ") : "none yet")}
        {engine?.error && line("Error", <span className="text-err" title={engine.error}>{engine.error.split("\n").pop()}</span>)}
      </div>
      <Row label="Maintenance" hint="Repair rebuilds the Python environment from scratch. Downloaded models are kept.">
        <button className="btn btn-secondary" disabled={checking} onClick={recheck}>
          <Icon name="retry" />
          {checking ? "Checking" : "Re-check"}
        </button>
        <button className="btn btn-secondary" disabled={setup?.running} onClick={() => install(!!engine?.venv)}>
          <Icon name="download" />
          {engine?.venv ? "Repair" : "Install"}
        </button>
        <button className="btn btn-ghost" disabled={!engine?.ready} onClick={() => api.engineRestart().then(() => toast({ tone: "info", title: "Engine restarted", body: "The model is reloaded for the next file." }))}>
          Restart engine
        </button>
      </Row>
      {setup && (
        <div className="border-t border-line-1 pb-3.5">
          <SetupProgress />
        </div>
      )}
      <Row label="Python for setup" hint="The interpreter used to create the engine's environment. Auto picks the newest compatible one.">
        <span className="t-data min-w-0 flex-1 truncate text-fg-2">{settings.pythonPath || "Auto"}</span>
        {settings.pythonPath && (
          <button className="btn btn-ghost" onClick={() => useApp.getState().saveSettings({ pythonPath: "" })}>
            Use auto
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => api.choosePython().then((s) => s && (setSettings(s), recheck()), () => {})}>
          Choose
        </button>
      </Row>
    </>
  );
}
