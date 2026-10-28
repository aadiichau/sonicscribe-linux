import { Icon, type IconName } from "../icons/Icon";
import { isActive, useApp, type View } from "../state/store";

function NavItem({ view, icon, label, count }: { view: View; icon: IconName; label: string; count?: number }) {
  const active = useApp((s) => s.view === view);
  const setView = useApp((s) => s.setView);
  return (
    <button
      onClick={() => setView(view)}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-8 w-full items-center gap-2.5 rounded px-2.5 text-left transition-colors duration-[90ms] ${active ? "bg-bg-2 text-fg-1" : "text-fg-2 hover:bg-bg-2 hover:text-fg-1"}`}
    >
      {active && <span className="absolute -left-2 top-2 bottom-2 w-0.5 bg-amber" />}
      <Icon name={icon} />
      {label}
      {count ? <span className="mono ml-auto rounded-[2px] bg-amber px-[5px] text-[11px] font-medium leading-4 text-[var(--amber-ink)]">{count}</span> : null}
    </button>
  );
}

/** The engine's live readout: realtime factor while transcribing, device when idle. */
function Heartbeat() {
  const engine = useApp((s) => s.engine);
  const paused = useApp((s) => s.paused);
  const stats = useApp((s) => {
    let speed = 0;
    let active = "";
    let queued = 0;
    for (const id of s.order) {
      const j = s.jobs[id];
      if (!j) continue;
      if (j.state === "queued") queued++;
      else if (isActive(j)) {
        active = j.state;
        speed = j.speed;
      }
    }
    return `${speed}|${active}|${queued}`;
  });
  const [speedS, active, queuedS] = stats.split("|");
  const speed = Number(speedS);
  const queued = Number(queuedS);
  const device = !engine ? "Checking engine" : !engine.ready ? "Engine not installed" : engine.cuda ? (engine.gpuName ?? "GPU").replace(/^NVIDIA (GeForce )?/, "") : "CPU";

  let readout = paused && queued ? "Paused" : "Idle";
  if (active === "transcribing") readout = speed > 0 ? `${speed.toFixed(1)}× realtime` : "Transcribing";
  else if (active === "downloading") readout = "Fetching model";
  else if (active === "loading") readout = "Loading model";

  return (
    <div className="mx-[-8px] mb-1.5 mt-2 border-t border-line-1 px-[18px] pt-3.5 pb-2">
      <div className="t-micro">Engine</div>
      <div className="mono mt-1.5 flex items-center gap-2 text-[15px] font-medium leading-5">
        {active && <span className="dot" />}
        {readout}
      </div>
      <div className="t-data mt-0.5 truncate text-fg-3" title={device}>
        {device}
      </div>
      <div className="t-data text-fg-3">{active ? "1 active" : "0 active"} · {queued} queued</div>
    </div>
  );
}

export function Sidebar() {
  const pending = useApp((s) => s.order.reduce((n, id) => n + (s.jobs[id] && (isActive(s.jobs[id]) || s.jobs[id].state === "queued") ? 1 : 0), 0));
  return (
    <nav className="flex flex-col gap-0.5 border-r border-line-1 bg-bg-0 px-2 py-3" aria-label="Main">
      <NavItem view="transcribe" icon="transcribe" label="Transcribe" count={pending} />
      <NavItem view="history" icon="history" label="History" />
      <div className="flex-1" />
      <Heartbeat />
      <NavItem view="settings" icon="settings" label="Settings" />
    </nav>
  );
}
