/** Locale-aware formatting for Desktop surfaces. Pure functions, no React or host state. */
import type { CaptureDestinationKind } from '@keystone/core';

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatMediaDuration(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatTimestamp(value: string | undefined, ru: boolean): string {
  const parsed = value ? new Date(value) : undefined;
  if (!value || !parsed || !Number.isFinite(parsed.valueOf())) return value ?? '';
  return new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export function taskStatusLabel(status: string, ru: boolean): string {
  return status === 'COMPLETED' ? (ru ? 'Выполнено' : 'Completed') : status === 'CANCELED' ? (ru ? 'Отменено' : 'Canceled') : (ru ? 'Активна' : 'Active');
}

export function taskPriorityLabel(priority: string, ru: boolean): string {
  return priority === 'HIGH' ? (ru ? 'Высокий приоритет' : 'High priority') : priority === 'MEDIUM' ? (ru ? 'Средний приоритет' : 'Medium priority') : priority === 'LOW' ? (ru ? 'Низкий приоритет' : 'Low priority') : '';
}

export function captureStateLabel(state: string, ru: boolean): string {
  const labels: Record<string, [string, string]> = { DRAFT: ['Черновик', 'Draft'], READY: ['Готово к разбору', 'Ready'], PROCESSING: ['Обрабатывается', 'Processing'], ROUTED: ['Разобрано', 'Filed'], FAILED: ['Ошибка', 'Failed'], DISMISSED: ['Отклонено', 'Dismissed'] };
  const value = labels[state];
  return value ? (ru ? value[0] : value[1]) : state;
}

export function ruPlural(count: number, one: string, few: string, many: string): string {
  const rule = new Intl.PluralRules('ru-RU').select(count);
  return rule === 'one' ? one : rule === 'few' ? few : many;
}

export function formatCalendarTime(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'; }

export function captureSourceLabel(source: string, ru: boolean): string { const labels: Record<string, [string, string]> = { FILE_DROP: ['Файл', 'File'], KEYSTONE_OBJECT: ['Объект Keystone', 'Keystone object'], BROWSER_PAGE: ['Страница', 'Page'], BROWSER_SELECTION: ['Выделение', 'Selection'], CLIPBOARD: ['Буфер обмена', 'Clipboard'], USER_INPUT: ['Ввод', 'Text'] }; const value = labels[source]; return value ? (ru ? value[0] : value[1]) : (ru ? 'Локальный источник' : 'Local source'); }

export function captureDestinationLabel(destination: CaptureDestinationKind, ru: boolean): string { const labels: Record<CaptureDestinationKind, [string, string]> = { TASK: ['Задача', 'Task'], VAULT: ['Хранилище', 'Storage'], WEB_LIBRARY: ['Web Library', 'Web Library'], FILES: ['Файлы', 'Files'], PHOTOS: ['Фотографии', 'Photos'], DOCUMENTS: ['Документы', 'Documents'], CONTACTS: ['Контакты', 'Contacts'], CALENDAR: ['Календарь', 'Calendar'], WORKBOARD: ['Рабочая доска', 'Workboard'], SHARED_FOLDER: ['Общая папка', 'Shared folder'] }; const value = labels[destination]; return value ? (ru ? value[0] : value[1]) : destination; }

export function captureAccessLabel(dataClass: string, ru: boolean): string { return ru ? (dataClass === 'SECRET' ? 'Особо защищённые данные' : dataClass === 'PRIVATE' ? 'Приватные данные' : 'Данные устройства') : (dataClass === 'SECRET' ? 'Highly protected data' : dataClass === 'PRIVATE' ? 'Private data' : 'Device data'); }


/** Connectivity states as a person reads them; unknown codes fall back to the raw value. */
export function networkStateLabel(state: string, ru: boolean): string {
  const labels: Record<string, [string, string]> = { DEVICE_ONLY: ['This device only', 'Только это устройство'], LOCAL_ONLY: ['Local network', 'Локальная сеть'], NEARBY: ['Nearby', 'Рядом'], ONLINE: ['Online', 'В сети'], INTERNET: ['Internet', 'Интернет'], DELAY_TOLERANT: ['Delayed delivery', 'Отложенная доставка'], OFFLINE: ['Offline', 'Не в сети'] };
  return labels[state]?.[ru ? 1 : 0] ?? state;
}

export function networkReachabilityLabel(reachability: string, ru: boolean): string {
  const labels: Record<string, [string, string]> = { UNAVAILABLE: ['No route', 'Маршрута нет'], AVAILABLE: ['Reachable', 'Доступно'], REACHABLE: ['Reachable', 'Доступно'], EVENTUALLY: ['Will be delivered later', 'Будет доставлено позже'], DEGRADED: ['Unstable', 'Нестабильно'], UNKNOWN: ['Unknown', 'Неизвестно'] };
  return labels[reachability]?.[ru ? 1 : 0] ?? reachability;
}

/** Message of a failure for the user. Native (Tauri) commands reject with a plain string, not an Error. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error.trim() ? error : fallback;
}
