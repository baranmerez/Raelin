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
  image: "M4 5h16v14H4zM4 15.5l4.5-4.5 4 4 2.5-2.5L20 17.5M15.5 9.5h.01",
  pencil: "M14.5 5.5l4 4L9 19H5v-4zM12.5 7.5l4 4",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5",
  eraser:
    "M8.5 19.5 3.8 14.8a1.6 1.6 0 0 1 0-2.3l8.4-8.4a1.6 1.6 0 0 1 2.3 0l4.7 4.7a1.6 1.6 0 0 1 0 2.3l-8.9 8.4ZM8 9l7.5 7.5M8.5 19.5H20",
  alignLeft: "M4 4v16M8 7h11v3.5H8zM8 13.5h7V17H8z",
  alignCenter: "M12 4v16M6 7h12v3.5H6zM8.5 13.5h7V17h-7z",
  alignRight: "M20 4v16M5 7h11v3.5H5zM9 13.5h7V17H9z",
  alignTop: "M4 4h16M7 8h3.5v11H7zM13.5 8H17v7h-3.5z",
  alignMiddle: "M4 12h16M7 6h3.5v12H7zM13.5 8.5H17v7h-3.5z",
  alignBottom: "M4 20h16M7 5h3.5v11H7zM13.5 9H17v7h-3.5z",
  distributeH: "M4 4v16M20 4v16M9.5 8h5v8h-5z",
  distributeV: "M4 4h16M4 20h16M8 9.5h8v5H8z",
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
