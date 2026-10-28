/** 1.2 GB / 340 MB / 12 KB — decimal units, like file managers. */
export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

/** Media clock: 0:07, 12:04, 1:02:05. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Human duration for elapsed processing time: 48 s, 3 min 12 s, 1 h 4 min. */
export function took(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export function realtime(duration: number, elapsed: number): string {
  return elapsed > 0 ? `${(duration / elapsed).toFixed(1)}×` : "—";
}

/** Today 14:05 / Yesterday 09:12 / 3 Oct 2026. */
export function when(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const t = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${t}`;
  if (diff === 1) return `Yesterday ${t}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** Splits text around case-insensitive matches of any term, for <mark> highlighting. */
export function highlight(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const ts = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ts.length) return [{ text, hit: false }];
  const re = new RegExp(`(${ts.join("|")})`, "gi");
  return text
    .split(re)
    .filter((p) => p !== "")
    .map((p) => ({ text: p, hit: ts.some((t) => new RegExp(`^${t}$`, "i").test(p)) }));
}

/** "NVIDIA GeForce RTX 3050 6GB Laptop GPU · CUDA" → "RTX 3050 6GB · CUDA". */
export function shortDevice(d: string | null | undefined): string | null {
  return d ? d.replace(/^NVIDIA (GeForce )?/, "").replace(/ (Laptop )?GPU\b/, "") : null;
}
