import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../../ipc/api";
import type { Record as Transcript, Summary } from "../../ipc/types";
import { Icon } from "../../icons/Icon";
import { Empty } from "../../design/controls";
import { languageName } from "../../lib/catalog";
import { clock, highlight, plural, realtime, when } from "../../lib/format";
import { useApp } from "../../state/store";
import { TranscriptActions, TranscriptLines } from "../transcribe/Transcript";

export default function HistoryView() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Summary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Refresh when a job finishes, since it lands in history.
  const doneCount = useApp((s) => s.order.filter((id) => s.jobs[id]?.state === "done").length);

  useEffect(() => {
    const t = setTimeout(() => {
      api.historyList(query).then((list) => {
        setItems(list);
        setSelected((cur) => (cur && list.some((x) => x.id === cur) ? cur : (list[0]?.id ?? null)));
      });
    }, query ? 120 : 0);
    return () => clearTimeout(t);
  }, [query, doneCount]);

  const terms = query.split(/\s+/).filter(Boolean);
  const onChanged = (next: Summary | null, removedId?: string) =>
    setItems((list) => {
      if (!list) return list;
      if (removedId) {
        const i = list.findIndex((x) => x.id === removedId);
        const rest = list.filter((x) => x.id !== removedId);
        setSelected(rest[Math.min(i, rest.length - 1)]?.id ?? null);
        return rest;
      }
      return list.map((x) => (next && x.id === next.id ? next : x));
    });

  return (
    <div className="rise flex h-full flex-col px-6 pt-5 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">History</h1>
        {items && <span className="t-data text-fg-3">{query ? `${items.length} ${items.length === 1 ? "match" : "matches"}` : plural(items.length, "transcript")}</span>}
        <div className="flex-1" />
        <label className="field flex w-80 items-center gap-2">
          <Icon name="search" size={14} className="text-fg-3" />
          <input
            id="history-search"
            className="min-w-0 flex-1 bg-transparent outline-none"
            placeholder="Search names and transcripts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
        </label>
      </div>

      {items && items.length === 0 && !query ? (
        <section className="panel min-h-0 flex-1">
          <Empty title="No transcripts yet." hint="Everything you transcribe is kept here, searchable, until you delete it.">
            <button className="btn btn-secondary" onClick={() => useApp.getState().setView("transcribe")}>
              Go to Transcribe
            </button>
          </Empty>
        </section>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-4">
          <section className="panel scroll min-h-0" role="listbox" aria-label="Transcripts">
            {items?.length === 0 && <Empty title="No matches." hint="Every word must appear in the name or the transcript." />}
            {items?.map((it) => (
              <button
                key={it.id}
                role="option"
                aria-selected={selected === it.id}
                onClick={() => setSelected(it.id)}
                className={`block w-full border-b border-line-1 px-3 py-2.5 text-left ${selected === it.id ? "row-sel" : "hover:bg-bg-3"}`}
              >
                <div className="truncate font-medium">{highlight(it.name, terms).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : p.text))}</div>
                <div className="t-data mt-0.5 text-fg-3">
                  {when(it.createdAt)} · {clock(it.duration)} · {plural(it.words, "word")}
                </div>
                <div className="t-meta mt-1 line-clamp-2 text-fg-2">{snippet(it.preview, terms)}</div>
              </button>
            ))}
          </section>
          {selected ? <Reader key={selected} id={selected} terms={terms} onChanged={onChanged} /> : <section className="panel" />}
        </div>
      )}
    </div>
  );
}

function snippet(preview: string, terms: string[]) {
  return highlight(preview || "No speech found.", terms).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : p.text));
}

function Reader({ id, terms, onChanged }: { id: string; terms: string[]; onChanged: (s: Summary | null, removed?: string) => void }) {
  const [rec, setRec] = useState<Transcript | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    api.historyGet(id).then(setRec, (e) => setErr(errorText(e)));
  }, [id]);

  if (err) return <section className="panel"><Empty title="Couldn't open this transcript." hint={err} /></section>;
  if (!rec) return <section className="panel" />;

  const rename = (name: string) => {
    setEditing(false);
    if (!name.trim() || name === rec.name) return;
    api.historyRename(id, name).then(
      (s) => {
        setRec({ ...rec, name: s.name });
        onChanged(s);
      },
      (e) => toast({ tone: "err", title: "Couldn't rename", body: errorText(e) }),
    );
  };
  const remove = () =>
    api.historyDelete(id).then(
      () => onChanged(null, id),
      (e) => toast({ tone: "err", title: "Couldn't delete", body: errorText(e) }),
    );

  const meta = [clock(rec.duration), languageName(rec.language), rec.model, rec.device, rec.elapsed ? `${realtime(rec.duration, rec.elapsed)} realtime` : null, when(rec.createdAt)].filter(Boolean);

  return (
    <section className="panel flex min-h-0 flex-col" aria-label="Transcript">
      <header className="flex shrink-0 items-start gap-3 border-b border-line-1 px-6 py-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={nameRef}
              autoFocus
              defaultValue={rec.name}
              className="field h-7 w-full text-[15px] font-semibold"
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(e.currentTarget.value);
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <button className="group flex max-w-full items-center gap-2 text-left text-[15px] font-semibold" title="Rename" onClick={() => setEditing(true)}>
              <span className="truncate">{rec.name}</span>
              <Icon name="edit" size={14} className="shrink-0 text-fg-3 opacity-0 group-hover:opacity-100" />
            </button>
          )}
          <div className="t-data mt-1 truncate text-fg-3" title={rec.path}>
            {meta.join(" · ")}
          </div>
        </div>
        <button className="btn btn-icon" title="Show source file" aria-label="Show source file" onClick={() => api.openPath(rec.path, true).catch((e) => toast({ tone: "err", title: "Couldn't open", body: errorText(e) }))}>
          <Icon name="folder" />
        </button>
        {confirming ? (
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Keep</button>
            <button className="btn btn-danger" onClick={remove} autoFocus>Delete transcript</button>
          </div>
        ) : (
          <button className="btn btn-icon" title="Delete from history" aria-label="Delete from history" onClick={() => setConfirming(true)}>
            <Icon name="trash" />
          </button>
        )}
        <TranscriptActions id={id} disabled={!rec.segments.length} />
      </header>
      <div className="min-h-0 flex-1">
        {rec.segments.length ? <TranscriptLines segments={rec.segments} terms={terms} scrollToFirstHit /> : <Empty title="No speech found." hint="This file had no detectable speech." />}
      </div>
    </section>
  );
}
