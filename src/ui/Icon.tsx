const paths = {
  pointer: "M5 3.5 18.5 10l-6 1.8L10 18 5 3.5Z",
  pen: "M4 16.5c3-1 4.6-5.8 7.4-8.6 1.6-1.6 3.6-1.9 4.7-.8 1.1 1.1.8 3.1-.8 4.7-2.8 2.8-7.6 4.4-8.6 7.4",
  process: "M4 6.5h16v11H4z",
  decision: "M12 3.5 20.5 12 12 20.5 3.5 12Z",
  terminal: "M8 6.5h8a5.5 5.5 0 0 1 0 11H8a5.5 5.5 0 0 1 0-11Z",
  note: "M5 4.5h14v9.5l-5 5H5zM14 19v-5h5",
  region: "M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  export: "M12 4v11M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5",
  folder: "M3.5 7V5.5h6l2 2h9V18.5h-17z",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chevron: "m7 10 5 5 5-5",
  copy: "M8 8h11v11H8zM5 16V5h11",
  file: "M6 3.5h8l4 4v13H6zM14 3.5v4h4",
  palette:
    "M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-1 1.3-2-.6-1.2.2-2.5 1.6-2.5h1.6a4 4 0 0 0 4-4c0-4.7-3.8-8.5-8.5-8.5Z",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  sparkle: "M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8Z",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
