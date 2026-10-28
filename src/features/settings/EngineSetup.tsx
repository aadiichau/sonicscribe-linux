import { useState } from "react";
import { Icon } from "../../icons/Icon";
import { useApp } from "../../state/store";

/** Install progress: step ruler, current step and the latest output line. Shared by the banner and Settings. */
export function SetupProgress() {
  const setup = useApp((s) => s.setup);
  const [details, setDetails] = useState(false);
  if (!setup) return null;
  const pct = setup.error ? ((setup.step - 1) / setup.steps) * 100 : ((setup.step - 0.5) / setup.steps) * 100;
  const last = setup.lines[setup.lines.length - 1];
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline gap-3">
        <span className={setup.error ? "text-err" : "text-fg-1"}>{setup.error ? `Failed: ${setup.label}` : setup.label}</span>
        <span className="t-data ml-auto text-fg-3">
          step {setup.step} / {setup.steps}
        </span>
      </div>
      <div className="ruler">
        <div className={`fill ${setup.error ? "err" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      {setup.running && last && <div className="logline mt-2 truncate whitespace-nowrap">{last}</div>}
      {setup.error && (
        <div className="mt-3">
          <div className="logline selectable rounded border border-line-1 bg-bg-0 p-2 text-fg-2">{setup.error}</div>
          {setup.lines.length > 0 && (
            <button className="btn btn-ghost mt-1 h-7 px-2 text-xs" onClick={() => setDetails((d) => !d)}>
              {details ? "Hide" : "Show"} full log
            </button>
          )}
          {details && <div className="logline selectable scroll mt-1 max-h-48 rounded border border-line-1 bg-bg-0 p-2">{setup.lines.join("\n")}</div>}
        </div>
      )}
    </div>
  );
}

/** Shown on Transcribe until the engine works. */
export function SetupBanner() {
  const engine = useApp((s) => s.engine);
  const setup = useApp((s) => s.setup);
  const install = useApp((s) => s.install);
  if (!engine || (engine.ready && !setup)) return null;

  const broken = engine.venv && !engine.ready;
  return (
    <section className="panel rise mb-4 p-4" aria-label="Engine setup">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 text-amber">
          <Icon name="chip" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{broken ? "The transcription engine needs a repair" : "Set up the transcription engine"}</div>
          <div className="mt-0.5 text-fg-2">
            SonicScribe runs Whisper on this computer. Setup creates a private Python environment and installs faster-whisper
            {engine.nvidiaDriver ? " plus NVIDIA's CUDA libraries (about 1 GB) so your GPU does the work." : ". No NVIDIA driver was found, so transcription runs on the CPU."}{" "}
            Nothing outside SonicScribe's folder is changed and no admin rights are needed.
          </div>
          <div className="t-data mt-2 text-fg-3">
            {engine.systemPython ? (
              <>
                Python {engine.systemPython.version} · {engine.systemPython.path}
              </>
            ) : (
              <span className="text-warn">No Python 3.9–3.14 found. Install it first, e.g. `sudo pacman -S python`.</span>
            )}
            {broken && engine.error && <div className="mt-1 truncate text-err" title={engine.error}>{engine.error.split("\n").pop()}</div>}
          </div>
          <SetupProgress />
        </div>
        {!setup?.running && (
          <button className="btn btn-primary shrink-0" disabled={!engine.systemPython && !engine.venv} onClick={() => install(broken)}>
            <Icon name="download" />
            {setup?.error ? "Try again" : broken ? "Repair engine" : "Install engine"}
          </button>
        )}
      </div>
    </section>
  );
}
