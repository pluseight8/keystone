import React from 'react';

/**
 * Keystone's single outline icon language.  Icons are intentionally local
 * SVGs so the desktop bundle does not depend on a second visual system.
 */
export type IconName =
  | 'keystone' | 'home' | 'search' | 'capture' | 'check' | 'file-text'
  | 'settings' | 'device' | 'inbox' | 'bot' | 'message' | 'spaces' | 'vault'
  | 'graph' | 'canvas' | 'calendar' | 'contacts' | 'map' | 'mail' | 'files'
  | 'image' | 'phone' | 'board' | 'rss' | 'nearby' | 'plugins'
  | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'plus' | 'close'
  | 'undo' | 'pin' | 'more' | 'lock' | 'link' | 'external-link' | 'folder'
  | 'refresh' | 'play' | 'pause' | 'panel-right' | 'panel-left' | 'command'
  | 'info' | 'shield-check' | 'check-circle' | 'download' | 'upload' | 'save'
  | 'sun' | 'moon' | 'monitor' | 'sliders' | 'type' | 'globe' | 'wrench'
  | 'filter' | 'list' | 'grid' | 'clock' | 'spark' | 'archive' | 'trash'
  | 'edit' | 'copy' | 'arrow-right' | 'arrow-up' | 'arrow-down' | 'rotate-ccw'
  | 'eye' | 'eye-off' | 'warning' | 'circle' | 'folder-plus' | 'keyboard'
  | 'hard-drive' | 'network' | 'bell' | 'privacy' | 'database' | 'x-circle'
  | 'ellipsis' | 'layout' | 'maximize' | 'minimize' | 'menu' | 'loader'
  | 'book-open' | 'task' | 'document' | 'compass' | 'sidebar' | 'activity';

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly title?: string;
  readonly className?: string;
}

const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function Icon({ name, size = 16, strokeWidth = 1.8, title, className }: IconProps) {
  return <svg
    aria-hidden={title ? undefined : true}
    aria-label={title}
    className={className}
    focusable="false"
    height={size}
    role={title ? 'img' : undefined}
    viewBox="0 0 24 24"
    width={size}
    {...common}
    strokeWidth={strokeWidth}
  >
    {title ? <title>{title}</title> : null}
    {iconChildren[name]}
  </svg>;
}

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  readonly label: string;
  readonly icon: IconName;
  readonly size?: number;
}

export function IconButton({ label, icon, size = 16, className, ...props }: IconButtonProps) {
  return <button
    {...props}
    aria-label={label}
    className={['icon-button', className].filter(Boolean).join(' ')}
    data-tooltip={label}
    title={label}
    type={props.type ?? 'button'}
  >
    <Icon name={icon} size={size} />
  </button>;
}

const iconChildren: Record<IconName, React.ReactNode> = {
  keystone: <><path d="m12 3 7.5 4.5v9L12 21l-7.5-4.5v-9L12 3Z"/><path d="m8.5 9 3.5-2 3.5 2v4l-3.5 2-3.5-2V9Z"/></>,
  home: <><path d="m3.5 10.5 8.5-7 8.5 7"/><path d="M5.5 9.5V20h13V9.5M9.5 20v-5h5v5"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/></>,
  capture: <><path d="M6 3.5H4.5a1 1 0 0 0-1 1V6M18 3.5h1.5a1 1 0 0 1 1 1V6M6 20.5H4.5a1 1 0 0 1-1-1V18M18 20.5h1.5a1 1 0 0 0 1-1V18"/><path d="M12 7v10M7 12h10"/></>,
  check: <path d="m5 12.5 4.2 4.2L19.5 6.5"/>,
  'file-text': <><path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/></>,
  settings: <><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/><path d="m19.4 15.2 1.1 1.8-2.2 2.2-1.8-1.1a7.8 7.8 0 0 1-2.1.9l-.4 2.1H10.9l-.4-2.1a7.8 7.8 0 0 1-2.1-.9l-1.8 1.1-2.2-2.2 1.1-1.8a7.8 7.8 0 0 1-.9-2.1l-2.1-.4V9.6l2.1-.4a7.8 7.8 0 0 1 .9-2.1L4.4 5.3l2.2-2.2 1.8 1.1a7.8 7.8 0 0 1 2.1-.9l.4-2.1h3.1l.4 2.1a7.8 7.8 0 0 1 2.1.9l1.8-1.1 2.2 2.2-1.1 1.8a7.8 7.8 0 0 1 .9 2.1l2.1.4v3.1l-2.1.4a7.8 7.8 0 0 1-.9 2.1Z" transform="scale(.82) translate(2.6 2.6)"/></>,
  device: <><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M10 6h4M10 18h4"/></>,
  inbox: <><path d="M4 5.5h16v13H4z"/><path d="M4 14h4l1.4 2h5.2l1.4-2h4"/></>,
  bot: <><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8.5 16h7"/></>,
  message: <><path d="M4 5.5h16v11H9l-5 4v-15Z"/><path d="M8 10h8M8 13h5"/></>,
  spaces: <><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3.5 19c.5-3 2.1-4.5 4.5-4.5S12 16 12.5 19M11.5 19c.5-3 2.1-4.5 4.5-4.5s4 1.5 4.5 4.5"/></>,
  vault: <><path d="M4 6.5h16v13H4zM4 6.5l2-3h12l2 3"/><path d="M8 10h8M8 13h5"/></>,
  graph: <><circle cx="6" cy="7" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="15" cy="18" r="2"/><path d="m7.8 7.2 8.4-1.4M7.2 8.7l6.6 7.6M17.4 6.7l-1.8 9.4"/></>,
  canvas: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16M8 13h.01M12 13h.01M16 13h.01M8 16h.01M12 16h.01"/></>,
  contacts: <><circle cx="12" cy="8" r="3"/><path d="M5.5 20c.7-3.4 2.8-5 6.5-5s5.8 1.6 6.5 5M4 4h1M4 8h1M4 12h1"/></>,
  map: <><path d="m4 6 5-2 6 2 5-2v14l-5 2-6-2-5 2V6Z"/><path d="M9 4v14M15 6v14"/></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 6 7.5-6"/></>,
  files: <><path d="M5 4.5h10l4 4v11H5z"/><path d="M15 4.5v4h4M8 12h8M8 15h6"/></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4.5 17 4.5-4 3 2.5 2.2-2 5.3 4"/></>,
  phone: <><path d="M7 4.5 9.5 4l2 4-2 1.5a14 14 0 0 0 5 5L16 13l4 2-.5 2.5a2.5 2.5 0 0 1-2.8 2C9.5 18.5 5.5 14.5 4.5 7.3A2.5 2.5 0 0 1 7 4.5Z"/></>,
  board: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11M14 9v5h6"/></>,
  rss: <><path d="M5 19h.01M5 14a5 5 0 0 1 5 5M5 9a10 10 0 0 1 10 10M5 4a15 15 0 0 1 15 15"/></>,
  nearby: <><circle cx="12" cy="12" r="2"/><path d="M5.5 8.5a9 9 0 0 0 0 7M18.5 8.5a9 9 0 0 1 0 7M8.5 5.5a13 13 0 0 0 0 13M15.5 5.5a13 13 0 0 1 0 13"/></>,
  plugins: <><path d="M8 3v4M16 3v4M3 8h4M17 8h4M8 21v-4M16 21v-4M3 16h4M17 16h4"/><rect x="7" y="7" width="10" height="10" rx="2"/></>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  'chevron-left': <path d="m14.5 5-7 7 7 7"/>,
  'chevron-right': <path d="m9.5 5 7 7-7 7"/>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  undo: <><path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/></>,
  pin: <><path d="m8 4 8 0 1 5-3 3v6l-2 2-2-2v-6L7 9z"/></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/></>,
  link: <><path d="M10 13.5 8.5 15a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M14 10.5 15.5 9a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/><path d="m8 12 8-4"/></>,
  'external-link': <><path d="M14 5h5v5M19 5l-8 8"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>,
  folder: <><path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/></>,
  play: <path d="m8 5 11 7-11 7z"/>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  'panel-right': <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M15 4v16"/></>,
  'panel-left': <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16"/></>,
  command: <><circle cx="8" cy="8" r="2.5"/><circle cx="16" cy="16" r="2.5"/><path d="M10 8h4a2 2 0 0 1 2 2v4M14 16h-4a2 2 0 0 1-2-2v-4"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  'shield-check': <><path d="M12 3 19 6v5c0 4.5-3 8.1-7 10-4-1.9-7-5.5-7-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  'check-circle': <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  download: <><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14"/></>,
  upload: <><path d="M12 20V9M7.5 13 12 8.5l4.5 4.5M5 4h14"/></>,
  save: <><path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M9 20v-6h6v6"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  sliders: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--shell-bg, #111)"/><circle cx="15" cy="12" r="2" fill="var(--shell-bg, #111)"/><circle cx="11" cy="18" r="2" fill="var(--shell-bg, #111)"/></>,
  type: <><path d="M5 5h14M12 5v14M8 19h8"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  wrench: <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17a2 2 0 1 0 3 3l5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-2.5z"/>,
  filter: <><path d="M4 5h16l-6 7v5l-4 2v-7z"/></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></>,
  grid: <><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  spark: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4zM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6z"/></>,
  archive: <><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/></>,
  trash: <><path d="M5 7h14M10 11v5M14 11v5M9 7V4h6v3M7 7l1 13h8l1-13"/></>,
  edit: <><path d="m4 16.5-.8 3.8 3.8-.8L18.5 8 16 5.5zM14.5 7.5l2 2"/></>,
  copy: <><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
  'arrow-right': <><path d="M5 12h13M13 6l6 6-6 6"/></>,
  'arrow-up': <><path d="M12 19V6M6 12l6-6 6 6"/></>,
  'arrow-down': <><path d="M12 5v13M18 12l-6 6-6-6"/></>,
  'rotate-ccw': <><path d="M4 10a8 8 0 1 1 2 7"/><path d="M4 4v6h6"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  'eye-off': <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.8M6.2 6.8C3.8 8.3 2.5 12 2.5 12S6 18 12 18c1 0 1.9-.2 2.7-.5"/></>,
  warning: <><path d="m12 3 9 17H3z"/><path d="M12 9v4M12 16h.01"/></>,
  circle: <circle cx="12" cy="12" r="8"/>,
  'folder-plus': <><path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></>,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/></>,
  'hard-drive': <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h.01M11 15h6"/></>,
  network: <><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2h12v2"/></>,
  bell: <><path d="M6 17h12l-1.5-2v-4a4.5 4.5 0 0 0-9 0v4zM10 20h4"/></>,
  privacy: <><path d="M12 3 19 6v5c0 4.5-3 8.1-7 10-4-1.9-7-5.5-7-10V6z"/><path d="M9 12h6M12 9v6"/></>,
  database: <><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></>,
  'x-circle': <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  ellipsis: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
  layout: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 4v16M10 10h10"/></>,
  maximize: <><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"/></>,
  minimize: <path d="M5 19h14"/>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  loader: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></>,
  'book-open': <><path d="M4 5.5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2zM20 5.5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z"/></>,
  task: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9M8 7h4M8 17h7"/></>,
  document: <><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15h5"/></>,
  compass: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z"/></>,
  sidebar: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M13 8h4M13 12h4M13 16h3"/></>,
  activity: <><path d="M4 17h3l2-8 3 10 2-6h6"/></>,
};
