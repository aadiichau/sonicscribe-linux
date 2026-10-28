import { api, errorText } from "../../ipc/api";
import type { Job } from "../../ipc/types";
import { Icon } from "../../icons/Icon";
import { Ruler } from "../../design/Ruler";
import { Empty, Select, type Option } from "../../design/controls";
import { LANGUAGES, MODELS, languageName } from "../../lib/catalog";
import { bytes, clock, realtime, shortDevice, took } from "../../lib/format";
import { isActive, isFinished, useApp } from "../../state/store";
import { SetupBanner } from "../settings/EngineSetup";
import { TranscriptActions, TranscriptLines } from "./Transcript";

export function TranscribeView() {
  const order = useApp((s) => s.order);
  const jobs = useApp((s) => s.jobs);
  const paused = useApp((s) => s.paused);
  const hasFinished = order.some((id) => jobs[id] && isFinished(jobs[id]));

  return (
    <div className="rise flex h-full flex-col px-6 pt-5 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Transcribe</h1>
        <div className="flex-1" />
        {order.length > 0 && (
          <button className="btn btn-ghost" onClick={() => api.setPaused(!paused)} title={paused ? "Start the next file automatically" : "Finish the current file, then wait"}>
            <Icon name={paused ? "play" : "pause"} />
            {paused ? "Resume queue" : "Pause queue"}
          </button>
        )}
        {hasFinished && (
          <button className="btn btn-ghost" onClick={() => api.clearFinished()}>
            <Icon name="trash" />
            Clear finished
          </button>
        )}
      </div>
      <SetupBanner />
      <DropZone />
      <div className="mt-4 grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-4">
        <Queue />
        <Reader />
      </div>
    </div>
  );
}

function DropZone() {
  const settings = useApp((s) => s.settings);
  const engine = useApp((s) => s.engine);
  const { saveSettings, added, toast } = useApp.getState();
  const browse = () => api.pickFiles().then(added, (e) => toast({ tone: "err", title: "Couldn't add files", body: errorText(e) }));

  const modelOptions: Option[] = MODELS.map((m) => ({
    value: m.id,
    label: m.label,
    detail: m.note,
    tag: engine?.cachedModels.includes(m.id) ? "ready" : bytes(m.size),
  }));
  const langOptions: Option[] = LANGUAGES.map(([code, name]) => ({ value: code, label: name, tag: code === "auto" ? undefined : code }));

  return (
    <div className="dropzone" onClick={(e) => e.target === e.currentTarget && browse()}>
      <span className="pointer-events-none text-amber">
        <Icon name="wave" size={20} />
      </span>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="font-medium">Drop audio or video files</div>
        <div className="t-meta mt-0.5 truncate">MP3 · WAV · M4A · FLAC · OGG · OPUS · MP4 · MKV · WEBM · MOV — or a whole folder</div>
      </div>
      {settings && (
        <>
          <Select label="Model" width={190} value={settings.model} options={modelOptions} onChange={(model) => saveSettings({ model })} align="right" />
          <Select label="Language" width={160} value={settings.language} options={langOptions} onChange={(language) => saveSettings({ language })} align="right" filterable />
        </>
      )}
      <button className={`btn ${engine?.ready === false ? "btn-secondary" : "btn-primary"}`} onClick={browse}>
        <Icon name="plus" />
        Add files
      </button>
    </div>
  );
}

function Queue() {
  const order = useApp((s) => s.order);
  if (!order.length) {
    return (
      <section className="panel min-h-0">
        <Empty title="Nothing queued." hint="Drop files anywhere in the window. They're transcribed one after another." />
      </section>
    );
  }
  return (
    <section className="panel flex min-h-0 flex-col" aria-label="Queue">
      <div className="t-micro flex h-9 shrink-0 items-center border-b border-line-1 px-3">
        Queue <span className="t-data ml-auto normal-case tracking-normal">{order.length} files</span>
      </div>
      <div className="scroll min-h-0 flex-1" role="listbox" aria-label="Files">
        {order.map((id) => (
          <QueueRow key={id} id={id} />
        ))}
      </div>
    </section>
  );
}

function readout(j: Job): React.ReactNode {
  switch (j.state) {
    case "queued":
      return `Queued · ${j.model}`;
    case "downloading":
      return j.total ? `Fetching ${j.model} · ${bytes(j.bytes)} / ${bytes(j.total)}` : `Fetching ${j.model}`;
    case "loading":
      return j.stage;
    case "transcribing":
      return j.duration ? `${clock(j.position)} / ${clock(j.duration)}${j.speed ? ` · ${j.speed.toFixed(1)}×` : ""}` : j.stage;
    case "done":
      return `${clock(j.duration)} · ${took(j.elapsed ?? 0)} · ${realtime(j.duration, j.elapsed ?? 0)}`;
    case "failed":
      return <span className="text-err">{j.error}</span>;
    case "cancelled":
      return "Cancelled";
  }
}

function QueueRow({ id }: { id: string }) {
  const j = useApp((s) => s.jobs[id]);
  const selected = useApp((s) => s.selected === id);
  const select = useApp((s) => s.select);
  if (!j) return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => select(id)}
      onKeyDown={(e) => {
        if (e.key === "Delete") isActive(j) || j.state === "queued" ? api.cancelJob(id) : api.removeJobs([id]);
      }}
      className={`group relative border-b border-line-1 px-3 py-2.5 ${selected ? "row-sel" : "hover:bg-bg-3"}`}
    >
      <div className="flex items-center gap-2">
        <StateMark job={j} />
        <span className="min-w-0 flex-1 truncate font-medium" title={j.path}>
          {j.name}
        </span>
        <div className={`flex gap-0.5 ${selected ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`} onClick={stop}>
          {(isActive(j) || j.state === "queued") && (
            <button className="btn btn-icon h-6 w-6" aria-label="Cancel" title="Cancel" onClick={() => api.cancelJob(id)}>
              <Icon name="stop" size={14} />
            </button>
          )}
          {(j.state === "failed" || j.state === "cancelled") && (
            <button className="btn btn-icon h-6 w-6" aria-label="Retry" title="Retry with current model and language" onClick={() => api.retryJob(id)}>
              <Icon name="retry" size={14} />
            </button>
          )}
          {isFinished(j) && (
            <button className="btn btn-icon h-6 w-6" aria-label="Remove from list" title="Remove from list (stays in History)" onClick={() => api.removeJobs([id])}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="t-data mt-1 truncate pl-5 text-fg-3">{readout(j)}</div>
      {j.state !== "queued" && j.state !== "done" && (
        <div className="mt-2 pl-5">
          <Ruler job={j} />
        </div>
      )}
    </div>
  );
}

function StateMark({ job }: { job: Job }) {
  if (isActive(job)) return <span className="grid w-3 place-items-center"><span className="dot" /></span>;
  if (job.state === "done") return <Icon name="check" size={12} className="text-ok" />;
  if (job.state === "failed") return <Icon name="alert" size={12} className="text-err" />;
  return <span className="grid w-3 place-items-center"><span className="h-1.5 w-1.5 rounded-full bg-fg-4" /></span>;
}

function Reader() {
  const id = useApp((s) => s.selected);
  const j = useApp((s) => (id ? s.jobs[id] : undefined));
  const segments = useApp((s) => (id ? s.segments[id] : undefined));
  const toast = useApp((s) => s.toast);

  if (!j) {
    return (
      <section className="panel min-h-0">
        <Empty title="No file selected." hint="The transcript appears here, line by line, as it's written." />
      </section>
    );
  }

  const live = isActive(j);
  const meta = [
    j.duration ? clock(j.duration) : null,
    j.detectedLanguage ? languageName(j.detectedLanguage) : j.language !== "auto" ? languageName(j.language) : null,
    j.model,
    j.computeType ? `${shortDevice(j.device)} · ${j.computeType}` : shortDevice(j.device),
    j.segmentCount ? `${j.segmentCount} lines` : null,
  ].filter(Boolean);

  let body: React.ReactNode;
  if (j.state === "failed") {
    body = (
      <div className="p-6">
        <div className="flex items-start gap-2 text-err">
          <Icon name="alert" className="mt-0.5" />
          <div className="selectable min-w-0">{j.error}</div>
        </div>
        {j.hint && <div className="mt-2 pl-6 text-fg-2">{j.hint}</div>}
        {j.detail && (
          <details className="mt-4 pl-6">
            <summary className="t-meta cursor-default">Details</summary>
            <div className="logline selectable scroll mt-2 max-h-64 rounded border border-line-1 bg-bg-0 p-2">{j.detail}</div>
            <button className="btn btn-ghost mt-1 h-7 px-2 text-xs" onClick={() => api.copyText(j.detail ?? "").then(() => toast({ tone: "ok", title: "Copied details" }), () => {})}>
              <Icon name="copy" size={14} />
              Copy
            </button>
          </details>
        )}
        <button className="btn btn-secondary mt-5 ml-6" onClick={() => api.retryJob(j.id)}>
          <Icon name="retry" />
          Retry
        </button>
      </div>
    );
  } else if (j.state === "queued") {
    body = <Empty title="Waiting in the queue." hint="It starts when the file ahead of it finishes." />;
  } else if (!segments?.length && live) {
    body = (
      <div className="grid h-full place-items-center p-8">
        <div className="w-full max-w-sm text-center">
          <div className="text-fg-2">{j.stage}</div>
          <div className="t-meta mt-1">
            {j.state === "downloading"
              ? "First use of this model. It's saved for next time."
              : j.state === "transcribing"
                ? "Listening for the first words."
                : "Loading the model into memory."}
          </div>
          <div className="mt-4">
            <Ruler job={j} />
          </div>
          {j.state === "downloading" && j.total > 0 && (
            <div className="t-data mt-2 text-fg-3">
              {bytes(j.bytes)} / {bytes(j.total)}
            </div>
          )}
        </div>
      </div>
    );
  } else if (!segments?.length) {
    body = <Empty title={j.state === "cancelled" ? "Cancelled before any speech was found." : "No speech found."} hint="Try another language setting or a larger model." />;
  } else {
    body = <TranscriptLines segments={segments} live={live} />;
  }

  return (
    <section className="panel flex min-h-0 flex-col" aria-label="Transcript">
      <header className="flex shrink-0 items-start gap-4 border-b border-line-1 px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold" title={j.path}>
            {j.name}
          </div>
          <div className="t-data mt-1 truncate text-fg-3">{meta.join(" · ") || " "}</div>
        </div>
        <button className="btn btn-icon" title="Show source file" aria-label="Show source file" onClick={() => api.openPath(j.path, true).catch((e) => toast({ tone: "err", title: "Couldn't open", body: errorText(e) }))}>
          <Icon name="folder" />
        </button>
        <TranscriptActions id={j.id} disabled={!segments?.length || live} />
      </header>
      {live && j.duration > 0 && j.state === "transcribing" && (
        <div className="shrink-0 px-6 pt-3">
          <Ruler job={j} />
        </div>
      )}
      <div className="min-h-0 flex-1">{body}</div>
    </section>
  );
}
