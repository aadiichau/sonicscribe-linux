import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons/Icon";

export function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] items-center gap-6 border-t border-line-1 py-3.5">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="t-meta mt-0.5">{hint}</div>}
      </div>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-[160ms] disabled:opacity-40 ${on ? "border-amber bg-amber" : "border-line-3 bg-bg-3"}`}
    >
      <span className={`absolute top-[2px] h-3.5 w-3.5 rounded-full transition-[left,background] duration-[160ms] ${on ? "left-[18px] bg-[var(--amber-ink)]" : "left-[2px] bg-fg-3"}`} />
    </button>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="field flex w-28 items-center justify-between px-1" role="group" aria-label={label}>
      <button className="btn btn-icon h-6 w-6" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="mono">{value}</span>
      <button className="btn btn-icon h-6 w-6" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export interface Option {
  value: string;
  label: string;
  detail?: string;
  tag?: string;
}

/** Rabbit-style select: level-2 menu, 28 px items, amber check, type-to-filter for long lists. */
export function Select({ value, options, onChange, label, width = 200, align = "left", filterable }: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  label: string;
  width?: number;
  align?: "left" | "right";
  filterable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const close = () => {
    setOpen(false);
    setQ("");
  };
  const ref = useDismiss(open, close);
  const current = options.find((o) => o.value === value);
  const shown = q ? options.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(q.toLowerCase())) : options;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setHi(Math.max(0, shown.findIndex((o) => o.value === value)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const choose = (v: string) => {
    onChange(v);
    close();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") setHi((h) => Math.min(shown.length - 1, h + 1));
    else if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
    else if (e.key === "Enter" && shown[hi]) choose(shown[hi].value);
    else return;
    e.preventDefault();
  };

  return (
    <div className="relative" ref={ref} onKeyDown={onKey}>
      <button
        className="field flex items-center gap-2 text-left"
        style={{ width }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        {current?.tag && <span className="chip chip-sm">{current.tag}</span>}
        <Icon name="chevronDown" size={14} className="text-fg-3" />
      </button>
      {open && (
        <div className={`menu rise absolute top-[calc(100%+4px)] z-40 ${align === "right" ? "right-0" : "left-0"}`} style={{ minWidth: width }}>
          {filterable && (
            <input
              autoFocus
              className="field mb-1 h-7 w-full text-[12px]"
              placeholder="Type to filter"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
            />
          )}
          <div ref={listRef} className="scroll max-h-[320px]" role="listbox" aria-label={label}>
            {shown.map((o, i) => (
              <button
                key={o.value}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                className={`menu-item h-auto min-h-7 py-1 ${i === hi ? "bg-bg-3 text-fg-1" : ""}`}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(o.value)}
              >
                <span className="w-4 shrink-0 text-amber">{o.value === value && <Icon name="check" size={14} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.detail && <span className="t-meta block truncate">{o.detail}</span>}
                </span>
                {o.tag && <span className="chip chip-sm shrink-0">{o.tag}</span>}
              </button>
            ))}
            {!shown.length && <div className="t-meta px-2 py-1.5">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A button that opens a small action menu. */
export function MenuButton({ label, icon, children, className = "btn btn-secondary", align = "right", disabled }: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  className?: string;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  return (
    <div className="relative" ref={ref}>
      <button className={className} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {icon}
        {label}
        <Icon name="chevronDown" size={14} className="-mr-1 opacity-70" />
      </button>
      {open && (
        <div role="menu" className={`menu rise absolute top-[calc(100%+4px)] z-40 min-w-[240px] ${align === "right" ? "right-0" : "left-0"}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <div className="text-fg-2">{title}</div>
        <div className="t-meta mt-1">{hint}</div>
        {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
