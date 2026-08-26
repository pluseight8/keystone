/** Host boundary for the desktop Calendar surface. The shell never invents
 * events or copies Calendar objects; the application bootstrap installs the
 * existing CalendarService here after identity/storage/transport setup. */
export interface DesktopCalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly allDay: boolean;
  readonly calendarId: string;
  readonly visibility?: string;
  readonly tombstone?: boolean;
}

export interface DesktopCalendarSummary {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly visibility: string;
}

export interface DesktopCalendarRuntime {
  calendars(): Promise<readonly DesktopCalendarSummary[]>;
  events(input: { readonly calendarId: string; readonly from?: string; readonly until?: string; readonly expand?: boolean }): Promise<readonly DesktopCalendarEvent[]>;
  createEvent?(input: { readonly calendarId: string; readonly title: string; readonly start: string; readonly end: string }): Promise<DesktopCalendarEvent>;
  deleteEvent?(eventId: string): Promise<DesktopCalendarEvent>;
  findCommonTime?(): Promise<readonly { readonly start: string; readonly end: string }[]>;
}

let current: DesktopCalendarRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopCalendarRuntime(runtime: DesktopCalendarRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopCalendarRuntime(): DesktopCalendarRuntime | undefined { return current; }
export function subscribeDesktopCalendarRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
