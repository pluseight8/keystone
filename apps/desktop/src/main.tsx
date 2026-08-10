import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Strands from './Strands';
import './overlay.css';
import TerminalOnboarding from './onboarding';
import './onboarding.css';
import logoUrl from '../../../branding/logos/logo.png';
import logoTextUrl from '../../../branding/logos/text-of-logo.png';
const favicon = document.querySelector<HTMLLinkElement>('link[rel=\"icon\"]') ?? Object.assign(document.head.appendChild(document.createElement('link')), { rel: 'icon' });
favicon.href = logoUrl;
function App(){const [answer,setAnswer]=useState('Чем я могу помочь?');const [ready,setReady]=useState(()=>localStorage.getItem('keystone.onboarding.complete')==='1');if(!ready)return <TerminalOnboarding onComplete={({displayName,lifeMap})=>{localStorage.setItem('keystone.profile.name',displayName);localStorage.setItem('keystone.life-map.seed',JSON.stringify(lifeMap));localStorage.setItem('keystone.onboarding.complete','1');setReady(true)}}/>;return <main className="overlay"><section className="panel" aria-label="Keystone assistant"><Strands className="ambient" colors={['#ff183e','#9e2038','#681728']} count={3} speed={.7} amplitude={1} waviness={1.1} thickness={.65} glow={2} taper={2.5} spread={2} intensity={.35} saturation={1.4}/><div className="content"><header className="brand"><img className="brand-logo" src={logoUrl} alt=""/><img className="brand-name" src={logoTextUrl} alt="Keystone"/><span>/ AI</span></header><div className="answer" aria-live="polite">{answer}</div><form className="prompt" onSubmit={e=>{e.preventDefault();const input=e.currentTarget.elements.namedItem('prompt') as HTMLInputElement;if(input.value.trim()){setAnswer('Обрабатываю запрос локально…');input.value=''}}}><span className="status"/><input name="prompt" autoFocus autoComplete="off" placeholder="Спросите Keystone…" aria-label="Команда Keystone"/><span className="key">ENTER</span></form></div></section></main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
