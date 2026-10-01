const ICON_SIZES = {
  logo: [24, 24],
  "sidebar-toggle": [20, 20],
  search: [16, 16],
  "chevron-down": [14, 14],
  "pages-chevron": [12, 12],
  page: [16, 16],
  project: [16, 16],
  meeting: [13, 13],
  plus: [14, 14],
  trash: [16, 16],
  settings: [16, 16],
  share: [14, 14],
  star: [16, 16],
  more: [18, 18],
  "sync-cloud": [13, 13],
  table: [15, 15],
  board: [15, 15],
  "task-search": [14, 14],
  "task-open": [15, 15],
  "status-chevron": [10, 6],
  "select-chevron": [10, 6],
} as const;

export function DesignIcon({ name }: { name: keyof typeof ICON_SIZES }) {
  const [width, height] = ICON_SIZES[name];
  return (
    <span
      className={`design-icon design-icon-${name}`}
      aria-hidden="true"
      style={{ width, height }}
    />
  );
}
