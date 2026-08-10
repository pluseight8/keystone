import { useCallback, useEffect, useState } from 'react';

type Update = { version: string; body?: string | null; downloadAndInstall: (onEvent?: (event: unknown) => void) => Promise<void> };

export function UpdateBanner() {
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

  if (!update) return error ? <div className="update-banner update-error" role="status">Не удалось проверить обновления. Повторим при следующем запуске.</div> : null;
  return <aside className="update-banner" role="alert"><div><strong>Доступен патч безопасности {update.version}</strong><p>{update.body || 'Настоятельно рекомендуем обновиться сейчас.'}</p>{error && <small>Загрузка не удалась. Проверьте сеть и повторите.</small>}</div><button className="button primary" onClick={install} disabled={busy}>{busy ? 'Загрузка…' : 'Обновить и перезапустить'}</button></aside>;
}
