import type { CalendarService } from '@keystone/core';

/** Installed by the native/bootstrap layer after CalendarService, Chronos and
 * the authenticated P2P replication adapter are ready. */
export interface MobileCalendarRuntime { calendar: CalendarService; }
let current: MobileCalendarRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileCalendarRuntime(runtime: MobileCalendarRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileCalendarRuntime(): MobileCalendarRuntime | undefined { return current; }
export function subscribeMobileCalendarRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
