import { Icon } from "../icons/Icon";
import { useApp } from "../state/store";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast rise pointer-events-auto ${t.tone}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.title}</div>
              {t.body && <div className="selectable mt-0.5 text-xs leading-4 text-fg-2 [overflow-wrap:anywhere]">{t.body}</div>}
            </div>
            <button className="btn btn-icon -mr-1 -mt-1 h-6 w-6" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
