import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "../icons/Icon";
import { isTauri } from "../ipc/api";
import { useApp } from "../state/store";

const TITLES = { transcribe: "Transcribe", history: "History", settings: "Settings" } as const;

/** Rabbit's diamond with a waveform inside. */
export function BrandMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2.6" y="2.6" width="8.8" height="8.8" transform="rotate(45 7 7)" fill="none" stroke="var(--amber)" strokeWidth="1.3" />
      <path d="M5 6v2M7 4.6v4.8M9 5.8v2.4" stroke="var(--amber)" strokeWidth="1.3" strokeLinecap="square" />
    </svg>
  );
}

export function TitleBar() {
  const view = useApp((s) => s.view);
  const native = useApp((s) => s.settings?.nativeTitleBar ?? false);
  const [maximized, setMaximized] = useState(false);
  const win = isTauri() ? getCurrentWindow() : null;

  useEffect(() => {
    if (!win) return;
    win.isMaximized().then(setMaximized);
    const un = win.onResized(() => win.isMaximized().then(setMaximized));
    return () => {
      un.then((f) => f());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <header className="flex items-center border-b border-line-1 bg-bg-0" data-tauri-drag-region onDoubleClick={() => !native && win?.toggleMaximize()}>
      <div className="flex w-[var(--sidebar-w)] items-center gap-2.5 px-4 font-semibold tracking-[-0.01em]" data-tauri-drag-region>
        <BrandMark />
        SonicScribe
      </div>
      <span className="t-meta" data-tauri-drag-region>{TITLES[view]}</span>
      <div className="flex-1 self-stretch" data-tauri-drag-region />
      {!native && (
        <>
          <WinButton label="Minimize" icon="minimize" onClick={() => win?.minimize()} />
          <WinButton label={maximized ? "Restore" : "Maximize"} icon={maximized ? "restore" : "maximize"} onClick={() => win?.toggleMaximize()} />
          <WinButton label="Close" icon="x" danger onClick={() => win?.close()} />
        </>
      )}
    </header>
  );
}

function WinButton({ label, icon, onClick, danger }: { label: string; icon: "minimize" | "maximize" | "restore" | "x"; onClick: () => void; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`grid h-full w-[46px] place-items-center text-fg-2 transition-colors duration-[90ms] ${danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-bg-3 hover:text-fg-1"}`}
    >
      <Icon name={icon} />
    </button>
  );
}
