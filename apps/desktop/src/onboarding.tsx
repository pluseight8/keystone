import React from 'react';
import logoUrl from '../../../branding/logos/logo.png';
import logoTextUrl from '../../../branding/logos/text-of-logo.png';
import { Icon } from './desktop-icons';
import { DESKTOP_ACCENTS, type DesktopAccent, type DesktopDensity, type DesktopTheme } from './desktop-preferences';
import { pickDesktopFile, type PickedDesktopFile } from './desktop-host-bridge';

export type OnboardingInterest = 'communication' | 'media' | 'files' | 'planning' | 'ai' | 'knowledge' | 'browser' | 'everything';
export type OnboardingImportKind = 'audio' | 'video' | 'document' | 'file';
export type OnboardingAIProviderKind = 'ollama' | 'lm-studio' | 'openai-compatible';

export interface OnboardingImport {
  readonly kind: OnboardingImportKind;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface OnboardingResult {
  readonly displayName: string;
  readonly deviceName: string;
  readonly avatarInitials?: string;
  readonly localAi: boolean;
  readonly aiProviderKind?: OnboardingAIProviderKind;
  readonly aiEndpoint?: string;
  readonly aiModel?: string;
  readonly interests: readonly OnboardingInterest[];
  readonly imports: readonly OnboardingImport[];
  readonly privacyMode: 'private-by-default';
  readonly preferences: {
    readonly theme: DesktopTheme;
    readonly accent: DesktopAccent;
    readonly customAccent?: string;
    readonly density: DesktopDensity;
  };
}

export interface TerminalOnboardingProps {
  onComplete: (result: OnboardingResult) => void | Promise<void>;
  /** Kept source-compatible with the previous onboarding entry point. */
  typingDelayMs?: number;
}

type Step = 'welcome' | 'identity' | 'device' | 'focus' | 'imports' | 'ai' | 'privacy' | 'appearance' | 'ready';

const steps: readonly Step[] = ['welcome', 'identity', 'device', 'focus', 'imports', 'ai', 'privacy', 'appearance', 'ready'];
const interestOptions: readonly { key: OnboardingInterest; icon: 'message' | 'play' | 'files' | 'task' | 'bot' | 'vault' | 'globe' | 'spark'; title: string; detail: string }[] = [
  { key: 'communication', icon: 'message', title: 'Общение', detail: 'Сообщения, контакты и совместные пространства' },
  { key: 'media', icon: 'play', title: 'Музыка и видео', detail: 'Локальная библиотека и воспроизведение' },
  { key: 'files', icon: 'files', title: 'Файлы и документы', detail: 'Папки, Reader и заметки' },
  { key: 'planning', icon: 'task', title: 'Задачи и планы', detail: 'Сроки, напоминания и сегодняшний список' },
  { key: 'ai', icon: 'bot', title: 'Личный AI', detail: 'Модели на этом устройстве' },
  { key: 'knowledge', icon: 'vault', title: 'Знания и архив', detail: 'Vault, ссылки и Read Later' },
  { key: 'browser', icon: 'globe', title: 'Браузер', detail: 'Сохранение страниц и поиск' },
  { key: 'everything', icon: 'spark', title: 'Всё сразу', detail: 'Показывать все разделы' },
];

const clean = (value: string, max = 80): string => value.trim().replace(/\s+/g, ' ').slice(0, max);

function suggestedDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Это устройство';
  const platform = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  if (/android/i.test(platform)) return 'Android-устройство';
  if (/iphone|ipad/i.test(platform)) return 'iPhone или iPad';
  if (/mac/i.test(platform)) return 'Mac';
  if (/win/i.test(platform)) return 'Windows-компьютер';
  if (/linux/i.test(platform)) return 'Linux-компьютер';
  return 'Это устройство';
}

function accentValue(accent: DesktopAccent, customAccent?: string): string {
  if (accent === 'custom' && customAccent) return customAccent;
  return DESKTOP_ACCENTS[accent === 'custom' ? 'rose' : accent].value;
}

/** First-run setup for a real local owner/device profile and its initial UI. */
export function TerminalOnboarding({ onComplete, typingDelayMs }: TerminalOnboardingProps) {
  void typingDelayMs;
  const [step, setStep] = React.useState<Step>('welcome');
  const [displayName, setDisplayName] = React.useState('');
  const [avatarInitials, setAvatarInitials] = React.useState('');
  const [deviceName, setDeviceName] = React.useState(suggestedDeviceName);
  const [interests, setInterests] = React.useState<OnboardingInterest[]>(['everything']);
  const [imports, setImports] = React.useState<OnboardingImport[]>([]);
  const [localAi, setLocalAi] = React.useState(false);
  const [aiProviderKind, setAiProviderKind] = React.useState<OnboardingAIProviderKind>('ollama');
  const [aiEndpoint, setAiEndpoint] = React.useState('http://127.0.0.1:11434');
  const [aiModel, setAiModel] = React.useState('');
  const [aiStatus, setAiStatus] = React.useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [privacyConfirmed, setPrivacyConfirmed] = React.useState(true);
  const [theme, setTheme] = React.useState<DesktopTheme>('system');
  const [accent, setAccent] = React.useState<DesktopAccent>('rose');
  const [density, setDensity] = React.useState<DesktopDensity>('comfortable');
  const [busy, setBusy] = React.useState(false);
  const [importBusy, setImportBusy] = React.useState<OnboardingImportKind>();
  const [error, setError] = React.useState('');
  const ownerInput = React.useRef<HTMLInputElement>(null);
  const deviceInput = React.useRef<HTMLInputElement>(null);
  const currentStep = steps.indexOf(step);
  const progress = Math.round((currentStep / (steps.length - 1)) * 100);

  React.useEffect(() => {
    if (step === 'identity') requestAnimationFrame(() => ownerInput.current?.focus());
    if (step === 'device') requestAnimationFrame(() => deviceInput.current?.focus());
  }, [step]);

  const go = (next: Step) => { setError(''); setStep(next); };
  const toggleInterest = (value: OnboardingInterest) => {
    setInterests(current => {
      if (value === 'everything') return current.includes('everything') ? [] : ['everything'];
      const withoutEverything = current.filter(item => item !== 'everything');
      return withoutEverything.includes(value) ? withoutEverything.filter(item => item !== value) : [...withoutEverything, value];
    });
  };

  const importFile = async (kind: OnboardingImportKind) => {
    setImportBusy(kind); setError('');
    try {
      const file = await pickDesktopFile(kind);
      if (file) setImports(current => [...current.filter(item => !(item.kind === kind && item.name === file.name)), toOnboardingImport(kind, file)]);
    } catch (reason) {
      setError(readOnboardingError(reason));
    } finally {
      setImportBusy(undefined);
    }
  };

  const checkAi = async () => {
    const endpoint = normalizeLocalEndpoint(aiEndpoint);
    if (!endpoint) { setAiStatus('missing'); setError('Для локального AI укажите адрес localhost или 127.0.0.1.'); return; }
    setAiEndpoint(endpoint); setAiStatus('checking'); setError('');
    try {
      const response = await fetch(aiDiscoveryEndpoint(endpoint, aiProviderKind), { method: 'GET', headers: { accept: 'application/json' } });
      if (response.ok) {
        const payload = await response.json() as { readonly models?: readonly { readonly name?: string; readonly model?: string }[]; readonly data?: readonly { readonly id?: string }[] };
        const models = [...(payload.models?.map(item => item.name ?? item.model) ?? []), ...(payload.data?.map(item => item.id) ?? [])];
        const model = models.find(value => Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)));
        setAiModel(model ?? '');
        setAiStatus(model ? 'found' : 'missing');
      } else setAiStatus('missing');
      if (!response.ok) setError('Локальный AI пока не ответил. Настройку можно завершить и изменить позже.');
    } catch {
      setAiStatus('missing');
      setError('Локальный AI не найден. Keystone не обращается к удалённому сервису.');
    }
  };

  const finish = async () => {
    if (!privacyConfirmed) { setError('Подтвердите настройки приватности, чтобы продолжить.'); return; }
    setBusy(true); setError('');
    try {
      const normalizedEndpoint = localAi ? normalizeLocalEndpoint(aiEndpoint) : undefined;
      await onComplete({
        displayName: clean(displayName) || 'Вы',
        deviceName: clean(deviceName) || suggestedDeviceName(),
        ...(clean(avatarInitials, 2) ? { avatarInitials: clean(avatarInitials, 2).toUpperCase() } : {}),
        localAi,
        ...(localAi ? { aiProviderKind } : {}),
        ...(normalizedEndpoint ? { aiEndpoint: normalizedEndpoint } : {}),
        ...(aiModel ? { aiModel } : {}),
        interests: interests.length ? interests : ['everything'],
        imports,
        privacyMode: 'private-by-default',
        preferences: { theme, accent, ...(accent === 'custom' ? { customAccent: accentValue(accent, '#e9254d') } : {}), density },
      });
    } catch (reason) {
      setError(readOnboardingError(reason));
      setBusy(false);
    }
  };

  const title = step === 'welcome' ? 'Ваше пространство начинается здесь'
    : step === 'identity' ? 'Как к вам обращаться?'
      : step === 'device' ? 'Как назвать это устройство?'
        : step === 'focus' ? 'Что вы хотите держать под рукой?'
          : step === 'imports' ? 'Перенести что-нибудь сразу?'
            : step === 'ai' ? 'Нужен личный AI?'
              : step === 'privacy' ? 'Ваши правила по умолчанию'
                : step === 'appearance' ? 'Настройте внешний вид'
                  : 'Всё готово';

  const back = () => {
    const previous = steps[Math.max(0, currentStep - 1)];
    go(previous);
  };

  return <main className="onboarding-shell" data-onboarding-theme={theme} style={{ '--onboarding-accent': accentValue(accent, '#e9254d') } as React.CSSProperties}>
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <header className="onboarding-header">
        <div className="onboarding-brand"><img src={logoUrl} alt=""/><img src={logoTextUrl} alt="Keystone"/></div>
        <span className="onboarding-private-label"><Icon name="shield-check" size={14}/> Приватно по умолчанию</span>
      </header>
      <div className="onboarding-progress" role="progressbar" aria-label={`Настройка ${progress}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }}/></div>
      <div className="onboarding-content">
        <p className="onboarding-eyebrow">Настройка Keystone</p>
        <h1 id="onboarding-title">{title}</h1>

        {step === 'welcome' && <div className="onboarding-welcome">
          <p className="onboarding-lead">Keystone объединяет ваши файлы, документы, задачи, медиа и локальные инструменты в одном спокойном рабочем пространстве.</p>
          <div className="onboarding-welcome-preview"><span><Icon name="files" size={17}/> Файлы</span><span><Icon name="document" size={17}/> Документы</span><span><Icon name="task" size={17}/> Задачи</span><span><Icon name="bot" size={17}/> AI</span></div>
          <div className="onboarding-form-actions onboarding-welcome-actions"><button className="onboarding-primary" type="button" onClick={() => go('identity')}>Настроить Keystone <Icon name="arrow-right" size={16}/></button><button className="onboarding-secondary" type="button" onClick={() => go('identity')}>Сначала посмотреть</button></div>
          <p className="onboarding-footnote">Около пяти минут. Всё можно изменить позже в настройках.</p>
        </div>}

        {step === 'identity' && <div className="onboarding-form">
          <p className="onboarding-lead">Имя показывается только в этом устройстве и в ваших локальных объектах. Его можно оставить пустым.</p>
          <div className="onboarding-identity-row"><div className="onboarding-avatar" aria-hidden>{clean(avatarInitials, 2).toUpperCase() || '·'}</div><div className="onboarding-avatar-fields"><label htmlFor="profile-name">Имя</label><input ref={ownerInput} id="profile-name" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} autoComplete="name" placeholder="Например, Мария"/><label htmlFor="profile-avatar">Инициалы аватара <span>(необязательно)</span></label><input id="profile-avatar" value={avatarInitials} onChange={event => setAvatarInitials(event.target.value.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2))} maxLength={2} placeholder="MK"/></div></div>
          <OnboardingActions onBack={back} onNext={() => go('device')} next="Продолжить"/>
        </div>}

        {step === 'device' && <div className="onboarding-form">
          <p className="onboarding-lead">Это имя поможет отличить устройство, когда вы позже добавите continuity или обмен рядом.</p>
          <label htmlFor="device-name">Имя устройства</label><input ref={deviceInput} id="device-name" value={deviceName} onChange={event => setDeviceName(event.target.value)} maxLength={80} autoComplete="off" placeholder={suggestedDeviceName()}/>
          <p className="onboarding-inline-note"><Icon name="device" size={15}/> Обнаружено: {suggestedDeviceName()}</p>
          <OnboardingActions onBack={back} onNext={() => { if (!clean(deviceName)) setDeviceName(suggestedDeviceName()); go('focus'); }} next="Продолжить"/>
        </div>}

        {step === 'focus' && <div className="onboarding-form onboarding-wide-form">
          <p className="onboarding-lead">Выберите интересы — это только настройка стартовой навигации и домашнего экрана. Данные никуда не отправляются.</p>
          <div className="onboarding-interest-grid">{interestOptions.map(option => { const selected = interests.includes(option.key); return <button key={option.key} type="button" className={`onboarding-interest${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => toggleInterest(option.key)}><span className="onboarding-interest-icon"><Icon name={option.icon} size={17}/></span><span><strong>{option.title}</strong><small>{option.detail}</small></span>{selected ? <Icon name="check-circle" size={16}/> : null}</button>; })}</div>
          <OnboardingActions onBack={back} onNext={() => go('imports')} next="Продолжить"/>
        </div>}

        {step === 'imports' && <div className="onboarding-form onboarding-wide-form">
          <p className="onboarding-lead">Можно выбрать несколько локальных файлов. Keystone импортирует их после создания профиля; исходные файлы не удаляются.</p>
          <div className="onboarding-import-list">{(['audio', 'video', 'document', 'file'] as const).map(kind => { const selected = imports.filter(item => item.kind === kind); const label = kind === 'audio' ? 'Музыка' : kind === 'video' ? 'Видео' : kind === 'document' ? 'Документ' : 'Файл'; return <div className="onboarding-import-row" key={kind}><span className="onboarding-interest-icon"><Icon name={kind === 'audio' ? 'rss' : kind === 'video' ? 'play' : kind === 'document' ? 'document' : 'files'} size={17}/></span><span><strong>{label}</strong><small>{selected.length ? selected.map(item => item.name).join(', ') : 'Пока ничего не выбрано'}</small></span><button className="onboarding-secondary" type="button" onClick={() => void importFile(kind)} disabled={Boolean(importBusy)}>{importBusy === kind ? 'Открываем…' : 'Выбрать'}</button></div>; })}</div>
          <p className="onboarding-inline-note"><Icon name="info" size={15}/> Можно пропустить и импортировать позже из соответствующего раздела.</p>
          <OnboardingActions onBack={back} onNext={() => go('ai')} next="Продолжить"/>
        </div>}

        {step === 'ai' && <div className="onboarding-form">
          <p className="onboarding-lead">Keystone работает только с явно выбранным локальным провайдером. Удалённого fallback нет.</p>
          <div className="onboarding-choice-grid"><button type="button" className={`onboarding-choice-card${localAi ? ' selected' : ''}`} onClick={() => setLocalAi(true)}><strong>Подключить локальный AI</strong><span>Проверим Ollama или совместимый endpoint на этом устройстве.</span></button><button type="button" className={`onboarding-choice-card${!localAi ? ' selected' : ''}`} onClick={() => setLocalAi(false)}><strong>Настроить позже</strong><span>Раздел AI останется пустым до явного подключения.</span></button></div>
          {localAi && <div className="onboarding-ai-check"><label htmlFor="ai-provider">Провайдер</label><select id="ai-provider" value={aiProviderKind} onChange={event => { const next = event.target.value as OnboardingAIProviderKind; setAiProviderKind(next); setAiStatus('idle'); setAiModel(''); setAiEndpoint(next === 'ollama' ? 'http://127.0.0.1:11434' : next === 'lm-studio' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:8080/v1'); }}><option value="ollama">Ollama</option><option value="lm-studio">LM Studio</option><option value="openai-compatible">OpenAI-compatible localhost</option></select><label htmlFor="ai-endpoint">Локальный адрес</label><div><input id="ai-endpoint" value={aiEndpoint} onChange={event => { setAiEndpoint(event.target.value); setAiStatus('idle'); setAiModel(''); }} placeholder={aiProviderKind === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234/v1'}/><button className="onboarding-secondary" type="button" onClick={() => void checkAi()} disabled={aiStatus === 'checking'}>{aiStatus === 'checking' ? 'Проверяем…' : 'Проверить'}</button></div>{aiStatus === 'found' && <small className="onboarding-success"><Icon name="check-circle" size={14}/> Локальный провайдер отвечает · {aiModel}</small>}</div>}
          <OnboardingActions onBack={back} onNext={() => go('privacy')} next="Продолжить"/>
        </div>}

        {step === 'privacy' && <div className="onboarding-form">
          <p className="onboarding-lead">Ваши данные остаются на устройстве, пока вы сами не выберете действие, которое их раскрывает или отправляет.</p>
          <div className="onboarding-privacy-list"><p><Icon name="lock" size={16}/><span><strong>Приватные данные</strong><small>Профиль, задачи, документы и история поиска хранятся локально.</small></span></p><p><Icon name="network" size={16}/><span><strong>Сеть по запросу</strong><small>Синхронизация, обмен и внешние источники включаются только явным действием.</small></span></p><p><Icon name="bot" size={16}/><span><strong>AI без отправки наружу</strong><small>Без локального провайдера запросы не выполняются.</small></span></p></div>
          <label className="onboarding-check-row"><input type="checkbox" checked={privacyConfirmed} onChange={event => setPrivacyConfirmed(event.target.checked)}/><span>Понятно: приватность включена по умолчанию.</span></label>
          <OnboardingActions onBack={back} onNext={() => go('appearance')} next="Продолжить"/>
        </div>}

        {step === 'appearance' && <div className="onboarding-form onboarding-wide-form">
          <p className="onboarding-lead">Эти настройки применятся сразу после входа и сохранятся для следующих запусков.</p>
          <div className="onboarding-appearance-preview"><span className="onboarding-preview-dot"/><span><strong>Keystone</strong><small>Так будет выглядеть ваше рабочее пространство</small></span><span className="onboarding-preview-action" aria-hidden style={{ background: accentValue(accent, '#e9254d') }}>Открыть</span></div>
          <label>Тема</label><div className="onboarding-segmented">{(['system', 'light', 'dark'] as const).map(value => <button key={value} type="button" className={theme === value ? 'selected' : ''} onClick={() => setTheme(value)}>{value === 'system' ? 'Системная' : value === 'light' ? 'Светлая' : 'Тёмная'}</button>)}</div>
          <label>Акцент</label><div className="onboarding-accent-row">{(Object.keys(DESKTOP_ACCENTS) as Array<Exclude<DesktopAccent, 'custom'>>).map(value => <button key={value} type="button" className={accent === value ? 'selected' : ''} aria-label={DESKTOP_ACCENTS[value].label} onClick={() => setAccent(value)}><span style={{ background: DESKTOP_ACCENTS[value].value }}/></button>)}</div>
          <label>Плотность</label><div className="onboarding-segmented"><button type="button" className={density === 'comfortable' ? 'selected' : ''} onClick={() => setDensity('comfortable')}>Комфортная</button><button type="button" className={density === 'compact' ? 'selected' : ''} onClick={() => setDensity('compact')}>Компактная</button></div>
          <OnboardingActions onBack={back} onNext={() => go('ready')} next="Посмотреть итог"/>
        </div>}

        {step === 'ready' && <div className="onboarding-ready"><div className="onboarding-ready-icon" aria-hidden><Icon name="check-circle" size={25}/></div><p className="onboarding-lead">Создадим настоящую локальную identity, сохраним устройство и откроем ваш Home.</p><dl><div><dt>Владелец</dt><dd>{clean(displayName) || 'Вы'}</dd></div><div><dt>Устройство</dt><dd>{clean(deviceName) || suggestedDeviceName()}</dd></div><div><dt>Интересы</dt><dd>{interests.includes('everything') ? 'Все разделы' : `${interests.length} выбрано`}</dd></div><div><dt>Импорт</dt><dd>{imports.length ? `${imports.length} файл(а)` : 'Позже'}</dd></div><div><dt>AI</dt><dd>{localAi ? (aiStatus === 'found' ? `Локальный провайдер · ${aiModel}` : 'Настроить после входа') : 'Позже'}</dd></div><div><dt>Вид</dt><dd>{theme === 'system' ? 'Системная тема' : theme === 'light' ? 'Светлая тема' : 'Тёмная тема'} · {density === 'compact' ? 'компактно' : 'комфортно'}</dd></div></dl><div className="onboarding-form-actions"><button className="onboarding-secondary" type="button" onClick={back}>Назад</button><button className="onboarding-primary" type="button" onClick={() => void finish()} disabled={busy} aria-busy={busy}>{busy ? 'Создаём пространство…' : 'Открыть Keystone'} <Icon name="arrow-right" size={16}/></button></div></div>}
        {error && <p className="onboarding-error" role="alert">{error}</p>}
      </div>
      <footer className="onboarding-footer"><span>Без облачной учётной записи</span><span>Настройки можно изменить позже</span></footer>
    </section>
  </main>;
}

function OnboardingActions({ onBack, onNext, next }: { onBack: () => void; onNext: () => void; next: string }) {
  return <div className="onboarding-form-actions"><button className="onboarding-secondary" type="button" onClick={onBack}>Назад</button><button className="onboarding-primary" type="button" onClick={onNext}>{next} <Icon name="arrow-right" size={16}/></button></div>;
}

function toOnboardingImport(kind: OnboardingImportKind, file: PickedDesktopFile): OnboardingImport {
  return { kind, name: file.name, mimeType: file.mimeType, bytes: file.bytes };
}

function normalizeLocalEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function aiDiscoveryEndpoint(endpoint: string, kind: OnboardingAIProviderKind): string {
  const url = new URL(endpoint);
  if (kind === 'ollama') return `${url.origin}/api/tags`;
  if (/\/chat\/completions$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
  else if (!url.pathname.endsWith('/models')) url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
  return url.toString();
}

function readOnboardingError(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  if (reason && typeof reason === 'object') {
    const candidate = reason as { readonly message?: unknown; readonly error?: unknown };
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message.trim();
    if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error.trim();
    try {
      const serialized = JSON.stringify(reason);
      if (serialized && serialized !== '{}') return serialized.slice(0, 512);
    } catch {
      // Keep the stable fallback below for non-serializable host errors.
    }
  }
  return 'Не удалось создать локальное пространство.';
}

export default TerminalOnboarding;
