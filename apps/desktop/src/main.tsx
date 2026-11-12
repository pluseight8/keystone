import React from 'react';
import { createRoot } from 'react-dom/client';
import TerminalOnboarding, { type OnboardingResult } from './onboarding';
import './onboarding.css';
import logoUrl from '../../../branding/logos/logo.png';
import { bootstrapDesktopLocalRuntime, clearDesktopIndexedDbState, clearLocalDesktopRuntimeState, createLocalDesktopProfile, getLocalDesktopProfile, persistLocalDesktopProfile, type DesktopLocalDocumentsRuntime, type LocalDesktopProfile } from './desktop-local-runtime';
import { desktopIdentityAvailable, removeDesktopIdentity } from './desktop-host-bridge';
import { errorText } from './desktop-format';
import { Icon } from './desktop-icons';
import { getDesktopDocumentsRuntime } from './desktop-documents-runtime';
import { readDesktopPreferences, writeDesktopPreferences } from './desktop-preferences';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? Object.assign(document.head.appendChild(document.createElement('link')), { rel: 'icon' });
favicon.href = logoUrl;

type BootState =
  | { status: 'onboarding' }
  | { status: 'loading' }
  | { status: 'ready'; Shell: typeof import('./DesktopShell').default; notice?: string }
  | { status: 'error'; message: string };

function App() {
  const [profile] = React.useState(getLocalDesktopProfile);
  const [state, setState] = React.useState<BootState>(() => ({ status: profile ? 'loading' : 'onboarding' }));
  const startup = React.useRef<Promise<void>>();
  const en = profile !== undefined && localStorage.getItem('keystone.locale') === 'en';

  const bootExistingProfile = React.useCallback(async () => {
    if (!profile) return;
    setState({ status: 'loading' });
    try {
      const keyAvailable = await desktopIdentityAvailable(profile.deviceId);
      if (!keyAvailable) throw new Error(en
        ? 'The device key is unavailable. Unlock your system keyring and try again.'
        : 'Ключ устройства недоступен. Разблокируйте системное хранилище ключей и повторите попытку.');
      const [{ default: Shell }] = await Promise.all([
        import('./DesktopShell'),
        bootstrapDesktopLocalRuntime(profile),
      ]);
      setState({ status: 'ready', Shell });
    } catch (reason) {
      setState({
        status: 'error',
        message: errorText(reason, en ? 'Local services could not start.' : 'Локальные службы не запустились.'),
      });
    }
  }, [en, profile]);

  React.useEffect(() => {
    startup.current ??= bootExistingProfile();
  }, [bootExistingProfile]);

  const completeOnboarding = async (result: OnboardingResult) => {
    const previousProfile = localStorage.getItem('keystone.local.identity.v1');
    const nextProfile = await createLocalDesktopProfile(result.displayName, result.deviceName);
    let Shell: typeof import('./DesktopShell').default;
    let runtime: Awaited<ReturnType<typeof bootstrapDesktopLocalRuntime>>;
    try {
      ({ default: Shell } = await import('./DesktopShell'));
      runtime = await bootstrapDesktopLocalRuntime(nextProfile);
      persistLocalDesktopProfile(nextProfile);
      localStorage.setItem('keystone.onboarding.complete', '1');
    } catch (reason) {
      clearLocalDesktopRuntimeState(nextProfile);
      await Promise.allSettled([
        clearDesktopIndexedDbState(nextProfile.ownerIdentityId),
        removeDesktopIdentity(nextProfile.deviceId),
      ]);
      try {
        if (previousProfile === null) localStorage.removeItem('keystone.local.identity.v1');
        else localStorage.setItem('keystone.local.identity.v1', previousProfile);
      } catch {
        // Report the setup failure even if restoring the profile marker also fails.
      }
      throw reason;
    }

    let notice: string | undefined;
    try {
      writeDesktopPreferences({ ...readDesktopPreferences(), ...result.preferences });
      localStorage.setItem('keystone.local-ai.preference', result.localAi ? 'enabled' : 'skipped');
      localStorage.setItem('keystone.onboarding.focus.v1', JSON.stringify(result.interests));
      localStorage.setItem('keystone.privacy.mode.v1', result.privacyMode);
      if (result.avatarInitials) localStorage.setItem('keystone.local.avatar.v1', result.avatarInitials);
      if (result.localAi && result.aiEndpoint && result.aiModel) {
        const kind = result.aiProviderKind ?? 'ollama';
        const base = result.aiEndpoint.replace(/\/$/, '');
        const path = kind === 'ollama' ? '/api/chat' : '/chat/completions';
        const endpoint = base.endsWith(path) ? base : `${base}${path}`;
        await runtime.ai.configureLocalProvider({ kind, endpoint, model: result.aiModel, displayName: kind === 'lm-studio' ? 'LM Studio' : kind === 'openai-compatible' ? 'Local OpenAI-compatible' : 'Ollama' }).catch(() => {
          notice = 'Не удалось подключить локальный AI. Проверьте провайдера в настройках.';
        });
      }
      const importStatus = await applyOnboardingImports(runtime, result.imports);
      localStorage.setItem('keystone.onboarding.imports.v1', JSON.stringify({ version: 1, items: importStatus }));
      if (importStatus.some(item => item.status === 'failed')) notice = 'Некоторые файлы не импортированы. Подробности на главной.';
    } catch {
      notice = 'Не удалось сохранить все параметры настройки. Проверьте настройки и импорт.';
    }
    setState({ status: 'ready', Shell, notice });
  };

  if (state.status === 'onboarding') return <TerminalOnboarding onComplete={completeOnboarding}/>;
  if (state.status === 'loading') return <BootScreen title={en ? 'Opening Keystone…' : 'Запускаем Keystone…'} detail={en ? 'Checking this device’s key and opening local storage.' : 'Проверяем ключ устройства и открываем локальное хранилище.'}/>;
  if (state.status === 'error') return <main className="boot-error"><section className="boot-error-card" role="alert"><span className="onboarding-ready-icon" aria-hidden><Icon name="warning" size={25} /></span><h1>{en ? 'Keystone could not start' : 'Не удалось запустить Keystone'}</h1><p>{state.message}</p><button className="onboarding-primary" type="button" onClick={() => void bootExistingProfile()}>{en ? 'Try again' : 'Повторить'}</button></section></main>;
  const { Shell, notice } = state;
  return <Shell initialLocale={en ? 'en' : 'ru'} startupNotice={notice}/>;
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
