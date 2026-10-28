import { useEffect, useLayoutEffect, useRef } from "react";
import type { ExportFormat, Segment } from "../../ipc/types";
import { api, errorText } from "../../ipc/api";
import { Icon } from "../../icons/Icon";
import { FORMATS } from "../../lib/catalog";
import { clock, highlight, plural } from "../../lib/format";
import { useApp } from "../../state/store";
import { MenuButton } from "../../design/controls";

/** Timestamped lines. While `live`, it follows new lines unless the reader has scrolled up. */
export function TranscriptLines({ segments, live, terms = [], scrollToFirstHit }: { segments: Segment[]; live?: boolean; terms?: string[]; scrollToFirstHit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && live && pinned.current) el.scrollTop = el.scrollHeight;
  }, [segments.length, live]);

  useEffect(() => {
    if (scrollToFirstHit && terms.length) ref.current?.querySelector("mark")?.scrollIntoView({ block: "center" });
  }, [scrollToFirstHit, terms.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={ref}
      className="scroll h-full py-3"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {segments.map((s, i) => (
        <div key={i} className={`line ${live && i === segments.length - 1 ? "live" : ""}`}>
          <span className="ts">{clock(s.start)}</span>
          <span className="tx">
            {highlight(s.text, terms).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : p.text))}
          </span>
        </div>
      ))}
      {live && (
        <div className="line" aria-hidden="true">
          <span />
          <span className="tx">
            <span className="dot inline-block align-middle" />
          </span>
        </div>
      )}
    </div>
  );
}

/** Copy + Export menu for any transcript id (queue job or history record). */
export function TranscriptActions({ id, disabled }: { id: string; disabled?: boolean }) {
  const toast = useApp((s) => s.toast);
  const copy = (format: ExportFormat) =>
    api.copyTranscript(id, format).then(
      (words) => toast({ tone: "ok", title: "Copied to clipboard", body: plural(words, "word") }),
      (e) => toast({ tone: "err", title: "Couldn't copy", body: errorText(e) }),
    );
  const exportAs = (format: ExportFormat) =>
    api.exportTranscript(id, format).then(
      (path) => path && toast({ tone: "ok", title: "Exported", body: path }),
      (e) => toast({ tone: "err", title: "Couldn't export", body: errorText(e) }),
    );
  const exportAll = () =>
    api.exportAll(id, ["txt", "srt", "vtt"]).then(
      (paths) => toast({ tone: "ok", title: `Saved ${paths.length} files`, body: paths.join("\n") }),
      (e) => toast({ tone: "err", title: "Couldn't export", body: errorText(e) }),
    );

  return (
    <div className="flex items-center gap-2">
      <button className="btn btn-ghost" disabled={disabled} onClick={() => copy("txt")} title="Copy text">
        <Icon name="copy" />
        Copy
      </button>
      <MenuButton label="Export" icon={<Icon name="download" />} disabled={disabled}>
        {(close) => (
          <>
            <div className="t-micro px-2 pt-1.5 pb-1">Save as</div>
            {FORMATS.map((f) => (
              <button key={f.id} role="menuitem" className="menu-item whitespace-nowrap" onClick={() => (close(), exportAs(f.id))}>
                <span className="flex-1">{f.label}</span>
                <span className="t-data text-fg-3">{f.ext}</span>
              </button>
            ))}
            <button role="menuitem" className="menu-item whitespace-nowrap" onClick={() => (close(), exportAll())}>
              <span className="flex-1">TXT, SRT and VTT at once</span>
              <span className="t-data text-fg-3">folder</span>
            </button>
            <div className="mx-1 my-1 h-px bg-line-1" />
            <div className="t-micro px-2 pt-1 pb-1">Copy</div>
            <button role="menuitem" className="menu-item whitespace-nowrap" onClick={() => (close(), copy("timestamps"))}>
              <span className="flex-1">With timestamps</span>
            </button>
            <button role="menuitem" className="menu-item whitespace-nowrap" onClick={() => (close(), copy("srt"))}>
              <span className="flex-1">As SRT subtitles</span>
            </button>
          </>
        )}
      </MenuButton>
    </div>
  );
}
