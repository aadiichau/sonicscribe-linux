// Icon set shared with Rabbit: 16×16 grid, 1.5 px stroke, square caps, miter joins (docs/DESIGN_SYSTEM.md §7).
const PATHS = {
  home: "M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3v-3.5h2V13h3V6.5",
  queue: "M2.5 4h11M2.5 8h11M2.5 12h7M12 10.5V14m-1.75-1.75L12 14l1.75-1.75",
  library: "M2.5 2.5h4v11h-4zM8.5 2.5h2v11h-2zM11.5 3.2l1.9-.5 2 10.3-1.9.5z",
  settings: "M2.5 4.5h6m3 0h2M2.5 11.5h2m3 0h6M8.5 3v3h3V3zM4.5 10v3h3v-3z",
  paste: "M5.5 3H3.5v10.5h9V3h-2M5.5 2h5v2.5h-5z",
  link: "M6.8 9.2 9.2 6.8M7.2 4.6l1.4-1.4a2.6 2.6 0 0 1 3.7 3.7l-1.4 1.4M8.8 11.4l-1.4 1.4a2.6 2.6 0 0 1-3.7-3.7l1.4-1.4",
  download: "M8 2.5v8m-3.25-3.25L8 10.5l3.25-3.25M3 13.5h10",
  stop: "M4.5 4.5h7v7h-7z",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  play: "M5 3.2v9.6L12.5 8z",
  x: "m4 4 8 8m0-8-8 8",
  retry: "M12.5 6.5A4.75 4.75 0 1 0 12 10.5M12.5 2.5v4h-4",
  folder: "M2.5 3.5h4l1.5 1.5h5.5v7.5h-11z",
  file: "M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3",
  external: "M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
  trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4",
  check: "m3.5 8.5 3 3 6-7",
  alert: "M8 2.5 14 13.5H2zM8 7v3m0 1.75v.01",
  info: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM8 7.5v3.5M8 5.25v.01",
  search: "M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.3 10.3 13.5 13.5",
  chevronDown: "m4.5 6.5 3.5 3.5 3.5-3.5",
  video: "M2.5 4h8v8h-8zM10.5 7l3-2v6l-3-2",
  audio: "M3 6.5v3M5.5 4.5v7M8 2.5v11M10.5 5v6M13 7v2",
  image: "M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 1.5-1.5 3 3",
  subtitle: "M2.5 3.5h11v9h-11zM5 8.5h3m1.5 0H11M5 10.5h6",
  minimize: "M3 8h10",
  maximize: "M3.5 3.5h9v9h-9z",
  restore: "M3.5 5.5h7v7h-7zM5.5 5.5v-2h7v7h-2",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  wave: "M2 8h1.5M5 5v6M7.5 2.5v11M10 5.5v5M12.5 7v2M14 8h.01",
  transcribe: "M2 6.5v3M4.5 4.5v7M7 6v4M9.5 5h4.5M9.5 8h4.5M9.5 11h3",
  history: "M8 2.5a5.5 5.5 0 1 1-5.2 3.7M2.5 2.5v3.7h3.7M8 5v3.2l2.2 1.6",
  plus: "M8 3v10M3 8h10",
  chip: "M4.5 4.5h7v7h-7zM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14",
  edit: "M10.5 2.5 13.5 5.5 6 13H3v-3z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.2 : 1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={className}
      style={{ flex: "none" }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
