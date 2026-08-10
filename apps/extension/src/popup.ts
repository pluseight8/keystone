import logoUrl from '../../../branding/logos/logo.png';
import logoTextUrl from '../../../branding/logos/text-of-logo.png';
import { Readability } from '@mozilla/readability';
document.querySelector<HTMLImageElement>('#brand-logo')!.src = logoUrl;
document.querySelector<HTMLImageElement>('#brand-name')!.src = logoTextUrl;
const button = document.querySelector<HTMLButtonElement>('#index')!, status = document.querySelector('#status')!;
button.onclick = async () => { button.disabled = true; status.textContent = 'Очищаю страницу…'; try {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); if (!tab.id) throw new Error('No active tab');
  const [{result}] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:() => ({html:document.documentElement.outerHTML,url:location.href})});
  const documentCopy = new DOMParser().parseFromString(result!.html,'text/html'); const article = new Readability(documentCopy,{charThreshold:120}).parse();
  const text = article?.textContent?.replace(/\s+/g,' ').trim(); if (!text) throw new Error('No readable text');
  const response = await chrome.runtime.sendMessage({type:'index-page',page:{url:result!.url,title:article?.title||tab.title||'',byline:article?.byline||'',text}});
  if (!response?.ok) throw new Error(response?.error||'Index failed'); status.textContent = 'Добавлено в Карту жизни';
} catch(error) { status.textContent = error instanceof Error ? error.message : 'Ошибка'; button.disabled=false; } };
