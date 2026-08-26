import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import TerminalOnboarding from './onboarding';
import './onboarding.css';
import DesktopShell from './DesktopShell';
import logoUrl from '../../../branding/logos/logo.png';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? Object.assign(document.head.appendChild(document.createElement('link')), { rel: 'icon' });
favicon.href = logoUrl;

function App() {
  const [ready, setReady] = useState(() => localStorage.getItem('keystone.onboarding.complete') === '1');
  if (!ready) return <TerminalOnboarding onComplete={({ displayName, lifeMap }) => { localStorage.setItem('keystone.profile.name', displayName); localStorage.setItem('keystone.life-map.seed', JSON.stringify(lifeMap)); localStorage.setItem('keystone.onboarding.complete', '1'); setReady(true); }} />;
  return <DesktopShell initialLocale={(localStorage.getItem('keystone.locale') as 'en' | 'ru' | null) ?? 'ru'} />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
