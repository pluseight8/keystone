import React from 'react';
import { keystoneLinkForReference, type DesktopTab, type DesktopShellController } from './desktop-shell-model';
import { Icon } from './desktop-icons';

export function TypedReferenceDock({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: { readonly home: string; readonly links: string; readonly shareLink: string; readonly openInTab: string } }) {
  const ref = tab.object;
  if (!ref) return null;
  const link = keystoneLinkForReference(ref);
  const copyLink = async () => {
    try { await navigator.clipboard?.writeText(link); shell.setNotice(t.home === 'Главная' ? 'Ссылка скопирована' : 'Link copied'); }
    catch { shell.setNotice(t.home === 'Главная' ? 'Не удалось скопировать ссылку' : 'Could not copy link'); }
  };
  return <div className="reference-dock" aria-label={t.links}>
    <span className="section-label">{t.links}</span>
    <div>
      <button type="button" onClick={() => void copyLink()}><span><Icon name="link" size={13}/></span>{t.shareLink}</button>
      <button type="button" onClick={() => shell.openReference(ref, { allowDuplicate: true })}><span><Icon name="plus" size={13}/></span>{t.openInTab}</button>
    </div>
  </div>;
}
