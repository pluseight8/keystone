import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { DailyHomeScreen } from '../src/dailyHome';
import { getMobileSettingsRuntime } from '../src/settingsRuntime';

const STARTUP_ROUTES: Readonly<Record<string, string>> = {
  feed: '/following',
  video: '/video',
  messages: '/messages',
  storage: '/files',
  calendar: '/calendar',
  vault: '/vault',
};

/**
 * The Daily Layer is an optional overlay, not a forced mobile startup page.
 * Host-supported startup preferences redirect to their existing route; an
 * unavailable/custom target deliberately falls back to the local Home.
 */
export default function Home() {
  const router = useRouter();
  const [redirected, setRedirected] = useState(false);
  const surface = getMobileSettingsRuntime()?.settings.snapshot().startup.surface ?? 'last-opened';
  const target = STARTUP_ROUTES[surface];
  useEffect(() => {
    if (!target) return;
    setRedirected(true);
    router.replace(target as never);
  }, [router, target]);
  if (target && !redirected) return null;
  return <DailyHomeScreen />;
}
