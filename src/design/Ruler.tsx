import type { Job } from "../ipc/types";

/** Fraction done for a job: model download first, then audio position. */
export function jobFraction(j: Job): number | null {
  if (j.state === "done") return 1;
  if (j.state === "downloading") return j.total > 0 ? Math.min(1, j.bytes / j.total) : null;
  if (j.state === "transcribing" && j.duration > 0) return Math.min(1, j.position / j.duration);
  if (j.state === "failed" || j.state === "cancelled") return j.duration > 0 ? Math.min(1, j.position / j.duration) : 0;
  return j.state === "loading" ? null : 0;
}

/** Shared with Rabbit: hairline track, 10 % ticks, amber fill. */
export function Ruler({ job }: { job: Job }) {
  const f = jobFraction(job);
  const tone = job.state === "done" ? "ok" : job.state === "failed" ? "err" : job.state === "cancelled" ? "paused" : "";
  const indeterminate = f === null;
  return (
    <div className={`ruler ${indeterminate ? "indet" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f === null ? undefined : Math.round(f * 100)}>
      <div className={`fill ${tone}`} style={indeterminate ? undefined : { width: `${(f ?? 0) * 100}%` }} />
    </div>
  );
}
