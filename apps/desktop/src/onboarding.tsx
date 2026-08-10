import React from 'react';
import logoUrl from '../../../branding/logos/logo.png';
import logoTextUrl from '../../../branding/logos/text-of-logo.png';

export interface OnboardingLifeMapNode {
  id: string;
  type: 'person' | 'project';
  title: string;
  summary: string;
  position: { x: number; y: number };
}
export interface OnboardingLifeMap {
  nodes: OnboardingLifeMapNode[];
  edges: Array<{ id: string; source: string; target: string; label: string }>;
}
export interface TerminalOnboardingProps {
  onComplete: (result: { displayName: string; lifeMap: OnboardingLifeMap }) => void | Promise<void>;
  typingDelayMs?: number;
}

const INTRO = 'Инициализация локального профиля... Как к вам обращаться?';

/** One-question, local-first onboarding that guarantees a meaningful first graph. */
export function TerminalOnboarding({ onComplete, typingDelayMs = 28 }: TerminalOnboardingProps) {
  const [printed, setPrinted] = React.useState('');
  const [name, setName] = React.useState('');
  const [phase, setPhase] = React.useState<'typing' | 'answer' | 'creating'>('typing');
  const [error, setError] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (printed.length >= INTRO.length) { setPhase('answer'); requestAnimationFrame(() => input.current?.focus()); return; }
    const timer = window.setTimeout(() => setPrinted(INTRO.slice(0, printed.length + 1)), typingDelayMs);
    return () => window.clearTimeout(timer);
  }, [printed, typingDelayMs]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const displayName = name.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!displayName) { setError('Введите имя, чт��бы продолжить.'); return; }
    setError(''); setPhase('creating');
    await onComplete({ displayName, lifeMap: createStarterLifeMap(displayName) });
  };

  return <main className="onboarding-shell">
    <section className="onboarding-terminal" aria-labelledby="onboarding-title">
      <header className="terminal-header"><span id="onboarding-title" className="terminal-brand"><img src={logoUrl} alt=""/><img src={logoTextUrl} alt="Keystone"/><span>/ LOCAL PROFILE</span></span><span className="terminal-security">● LOCAL ONLY</span></header>
      <div className="terminal-body" aria-live="polite">
        <p className="terminal-line"><span className="terminal-prompt">keystone@local:~$</span> boot --profile</p>
        <p className="terminal-output">{printed}<span className="terminal-cursor" aria-hidden>_</span></p>
        {phase !== 'typing' && <form className="terminal-form" onSubmit={submit}>
          <label className="terminal-label" htmlFor="profile-name">NAME</label>
          <div className="terminal-input-row"><span aria-hidden>›</span><input ref={input} id="profile-name" value={name} onChange={event => setName(event.target.value)} disabled={phase === 'creating'} autoComplete="name" maxLength={80} aria-describedby={error ? 'name-error' : undefined}/><button disabled={phase === 'creating' || !name.trim()}>{phase === 'creating' ? 'CREATING GRAPH…' : 'CONTINUE ↵'}</button></div>
          {error && <p id="name-error" className="terminal-error">! {error}</p>}
        </form>}
        {phase === 'creating' && <div className="terminal-log"><p>+ Person: {name.trim()}</p><p>+ Project: Keystone Setup</p><p>+ Linking nodes locally...</p></div>}
      </div>
      <footer className="terminal-footer"><span>ENCRYPTED AT REST</span><span>NO CLOUD ACCOUNT</span></footer>
    </section>
  </main>;
}

export function createStarterLifeMap(displayName: string): OnboardingLifeMap {
  const suffix = stableId(displayName);
  const personId = `person-${suffix}`;
  const projectId = `project-keystone-setup-${suffix}`;
  return {
    nodes: [
      { id: personId, type: 'person', title: displayName, summary: `Person: ${displayName}`, position: { x: 104, y: 168 } },
      { id: projectId, type: 'project', title: 'Keystone Setup', summary: 'Ваш первый локальный проект', position: { x: 392, y: 168 } },
    ],
    edges: [{ id: `edge-${suffix}`, source: personId, target: projectId, label: 'owns' }],
  };
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

export default TerminalOnboarding;
