const endpoint = 'ws://127.0.0.1:43110/companion';
let socket: WebSocket | undefined;
function connect(): Promise<WebSocket> { return new Promise((resolve, reject) => {
  if (socket?.readyState === WebSocket.OPEN) return resolve(socket);
  const ws = new WebSocket(endpoint, ['keystone-companion-v1']);
  const timeout = setTimeout(() => { ws.close(); reject(new Error('Keystone is not running')); }, 2500);
  ws.onopen = () => { clearTimeout(timeout); socket = ws; resolve(ws); };
  ws.onerror = () => { clearTimeout(timeout); reject(new Error('Cannot reach the local Keystone host')); };
  ws.onclose = () => { if (socket === ws) socket = undefined; };
}); }
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'index-page') return;
  void connect().then(ws => { ws.send(JSON.stringify({type:'rag.upsert', document:{id:`page:${message.page.url}`,type:'note',text:message.page.text,metadata:{title:message.page.title,url:message.page.url,byline:message.page.byline,indexedAt:new Date().toISOString()}}})); respond({ok:true}); }).catch(error => respond({ok:false,error:String(error.message)}));
  return true;
});
