import React from 'react';
import { createRoot } from 'react-dom/client';
import TerminalOnboarding, { type OnboardingResult } from './onboarding';
import './onboarding.css';
import DesktopShell from './DesktopShell';
import logoUrl from '../../../branding/logos/logo.png';
import { bootstrapDesktopLocalRuntime, clearDesktopIndexedDbState, clearLocalDesktopRuntimeState, createLocalDesktopProfile, getLocalDesktopProfile, persistLocalDesktopProfile, type DesktopLocalDocumentsRuntime, type LocalDesktopProfile } from './desktop-local-runtime';
import { removeDesktopIdentity } from './desktop-host-bridge';
import { Icon } from './desktop-icons';
import { getDesktopDocumentsRuntime } from './desktop-documents-runtime';
import { readDesktopPreferences, writeDesktopPreferences } from './desktop-preferences';
import { DESKTOP_WINDOW_REGISTRY_KEY, DESKTOP_WINDOW_REGISTRY_QUARANTINE_KEY } from './desktop-shell-model';
import { DESKTOP_SESSION_RESTORE_POLICY_KEY } from './desktop-settings';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? Object.assign(document.head.appendChild(document.createElement('link')), { rel: 'icon' });
favicon.href = logoUrl;

type BootState = 'onboarding' | 'loading' | 'ready' | 'error';

function App() {
  const [profile, setProfile] = React.useState<LocalDesktopProfile | undefined>(() => getLocalDesktopProfile());
  const [pendingProfile, setPendingProfile] = React.useState<LocalDesktopProfile | undefined>();
  const [state, setState] = React.useState<BootState>(() => getLocalDesktopProfile() ? 'loading' : 'onboarding');
  const [error, setError] = React.useState('');

  const boot = React.useCallback(async (nextProfile: LocalDesktopProfile, options: { readonly transactional?: boolean } = {}): Promise<boolean> => {
    const previousProfile = localStorage.getItem('keystone.local.identity.v1');
    const previousMarker = localStorage.getItem('keystone.onboarding.complete');
    setState('loading'); setError('');
    try {
      if (options.transactional) persistLocalDesktopProfile(nextProfile);
      await bootstrapDesktopLocalRuntime(nextProfile);
      localStorage.setItem('keystone.onboarding.complete', '1');
      setProfile(nextProfile); setPendingProfile(undefined); setState('ready');
      return true;
    } catch (reason) {
      if (options.transactional) {
        clearLocalDesktopRuntimeState(nextProfile);
        await Promise.all([
          clearDesktopIndexedDbState(nextProfile.ownerIdentityId),
          removeDesktopIdentity(nextProfile.deviceId),
        ].map(operation => operation.catch(() => undefined)));
        try {
          if (previousProfile === null) localStorage.removeItem('keystone.local.identity.v1');
          else localStorage.setItem('keystone.local.identity.v1', previousProfile);
          if (previousMarker === null) localStorage.removeItem('keystone.onboarding.complete');
          else localStorage.setItem('keystone.onboarding.complete', previousMarker);
        } catch {
          // The original error is more useful to the user than a rollback
          // storage exception; reset setup remains available as a recovery path.
        }
      }
      setError(reason instanceof Error ? reason.message : 'Local runtime could not start.');
      setState('error');
      return false;
    }
  }, []);

  React.useEffect(() => {
    if (profile && state === 'loading') void boot(profile);
  }, [boot, profile, state]);

  const completeOnboarding = async (result: OnboardingResult) => {
    const nextProfile = await createLocalDesktopProfile(result.displayName, result.deviceName);
    setPendingProfile(nextProfile);
    setProfile(nextProfile);
    const committed = await boot(nextProfile, { transactional: true });
    if (!committed) return;
    // Preferences and optional imports are applied only after all durable
    // profile/runtime stores have been opened.  An unavailable optional
    // provider or a bad imported file cannot roll back a valid owner profile.
    writeDesktopPreferences({ ...readDesktopPreferences(), ...result.preferences });
    localStorage.setItem('keystone.local-ai.preference', result.localAi ? 'enabled' : 'skipped');
    localStorage.setItem('keystone.onboarding.focus.v1', JSON.stringify(result.interests));
    localStorage.setItem('keystone.privacy.mode.v1', result.privacyMode);
    if (result.avatarInitials) localStorage.setItem('keystone.local.avatar.v1', result.avatarInitials);
    const runtime = await bootstrapDesktopLocalRuntime(nextProfile);
    if (result.localAi && result.aiEndpoint && result.aiModel) {
      const kind = result.aiProviderKind ?? 'ollama';
      const endpoint = kind === 'ollama'
        ? (result.aiEndpoint.endsWith('/api/chat') ? result.aiEndpoint : `${result.aiEndpoint}/api/chat`)
        : (result.aiEndpoint.endsWith('/chat/completions') ? result.aiEndpoint : `${result.aiEndpoint.replace(/\/$/, '')}/chat/completions`);
      await runtime.ai.configureLocalProvider({ kind, endpoint, model: result.aiModel, displayName: kind === 'lm-studio' ? 'LM Studio' : kind === 'openai-compatible' ? 'Local OpenAI-compatible' : 'Ollama' }).catch(() => undefined);
    }
    const importStatus = await applyOnboardingImports(runtime, result.imports);
    localStorage.setItem('keystone.onboarding.imports.v1', JSON.stringify({ version: 1, items: importStatus }));
  };

  const resetSetup = () => {
    const previous = profile;
    for (const key of ['keystone.onboarding.complete', 'keystone.local.identity.v1', 'keystone.local-ai.preference', 'keystone.local.avatar.v1', 'keystone.onboarding.focus.v1', 'keystone.onboarding.imports.v1', 'keystone.privacy.mode.v1', 'keystone.local.ai-settings.v1', 'keystone.local.discovery.v1', 'keystone.desktop.workspaces.v1', 'keystone.desktop.current-workspace.v1', 'keystone.desktop.startup-surface.v1', DESKTOP_WINDOW_REGISTRY_KEY, DESKTOP_WINDOW_REGISTRY_QUARANTINE_KEY, DESKTOP_SESSION_RESTORE_POLICY_KEY, ...(previous ? [`keystone.local.ai-settings.v1:${previous.ownerIdentityId}`, `keystone.local.discovery.v1:${previous.ownerIdentityId}`] : [])]) localStorage.removeItem(key);
    if (previous) void removeDesktopIdentity(previous.deviceId).catch(() => undefined);
    setProfile(undefined); setPendingProfile(undefined); setError(''); setState('onboarding');
  };

  if (state === 'onboarding') return <TerminalOnboarding onComplete={completeOnboarding}/>;
  if (state === 'loading') return <BootScreen title="Запускаем локальное окружение…" detail="Проверяем owner identity и восстанавливаем Capture, Tasks, Documents, Discovery и local AI settings."/>;
  if (state === 'error') return <main className="boot-error"><section className="boot-error-card" role="alert"><span className="onboarding-ready-icon" aria-hidden><Icon name="warning" size={25} /></span><h1>Не удалось запустить Keystone</h1><p>{error}</p><div><button className="onboarding-primary" type="button" onClick={() => { const candidate = pendingProfile ?? profile; if (candidate) void boot(candidate, { transactional: Boolean(pendingProfile) }); }}>Повторить</button><button className="onboarding-secondary" type="button" onClick={resetSetup}>Начать настройку заново</button></div></section></main>;
  return <DesktopShell initialLocale={(localStorage.getItem('keystone.locale') as 'en' | 'ru' | null) ?? 'ru'} />;
}

async function applyOnboardingImports(runtime: Awaited<ReturnType<typeof bootstrapDesktopLocalRuntime>>, imports: OnboardingResult['imports']): Promise<readonly { readonly kind: string; readonly name: string; readonly status: 'imported' | 'failed'; readonly reason?: string }[]> {
  const documents = getDesktopDocumentsRuntime() as DesktopLocalDocumentsRuntime | undefined;
  const results: Array<{ kind: string; name: string; status: 'imported' | 'failed'; reason?: string }> = [];
  for (const item of imports.slice(0, 12)) {
    try {
      if (item.kind === 'audio' && runtime.media.music.importTrack) await runtime.media.music.importTrack({ filename: item.name, mimeType: item.mimeType, bytes: item.bytes });
      else if (item.kind === 'video' && runtime.media.video.importVideo) await runtime.media.video.importVideo({ filename: item.name, mimeType: item.mimeType, bytes: item.bytes });
      else if (item.kind === 'document' && documents?.importFile) await documents.importFile({ filename: item.name, mimeType: item.mimeType, bytes: item.bytes });
      else if (item.kind === 'file' && runtime.files.importFile) await runtime.files.importFile({ filename: item.name, mimeType: item.mimeType, bytes: item.bytes });
      else throw new Error('Этот тип файла пока недоступен для импорта');
      results.push({ kind: item.kind, name: item.name, status: 'imported' });
    } catch (reason) {
      results.push({ kind: item.kind, name: item.name, status: 'failed', reason: reason instanceof Error ? reason.message.slice(0, 240) : String(reason).slice(0, 240) });
    }
  }
  return results;
}

function BootScreen({ title, detail }: { title: string; detail: string }) {
  return <main className="boot-screen" aria-live="polite"><div className="boot-mark"><img src={logoUrl} alt=""/></div><h1>{title}</h1><p>{detail}</p><span className="boot-spinner" aria-hidden/></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
