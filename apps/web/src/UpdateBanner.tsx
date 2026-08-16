import { useCallback, useEffect, useState } from 'react';
import { useWebTranslation } from './i18n';

type Update = { version: string; body?: string | null; downloadAndInstall: (onEvent?: (event: unknown) => void) => Promise<void> };

export function UpdateBanner() {
  const { locale } = useWebTranslation();
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const checkForUpdate = useCallback(async () => {
    if (typeof window === 'undefined' || !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const available = await check({ timeout: 30_000 });
      if (available) setUpdate(available as unknown as Update);
    } catch { setError(true); }
  }, []);

  useEffect(() => { void checkForUpdate(); }, [checkForUpdate]);

  const install = async () => {
    if (!update) return;
    setBusy(true); setError(false);
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch { setError(true); setBusy(false); }
  };

  const t = locale === 'ru' ? { check: 'Не удалось проверить обновления. Повторим при следующем запуске.', available: 'Доступен патч безопасности', recommended: 'Настоятельно рекомендуем обновиться сейчас.', failed: 'Загрузка не удалась. Проверьте сеть и повторите.', downloading: 'Загрузка…', install: 'Обновить и перезапустить' } : { check: 'Unable to check for updates. We will retry on the next launch.', available: 'Security patch available', recommended: 'We strongly recommend updating now.', failed: 'Download failed. Check your network and try again.', downloading: 'Downloading…', install: 'Update and restart' };
  if (!update) return error ? <div className="update-banner update-error" role="status">{t.check}</div> : null;
  return <aside className="update-banner" role="alert"><div><strong>{t.available} {update.version}</strong><p>{update.body || t.recommended}</p>{error && <small>{t.failed}</small>}</div><button className="button primary" onClick={install} disabled={busy}>{busy ? t.downloading : t.install}</button></aside>;
}
