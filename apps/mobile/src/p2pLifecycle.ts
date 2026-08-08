export type P2PState = 'stopped'|'foreground'|'background-paused'|'background-limited';
export interface MobileP2PAdapter { start():Promise<void>; stop():Promise<void>; suspend():Promise<void>; resume():Promise<void>; state():P2PState; }
/** iOS/Android lifecycle policy: keep discovery foreground-first and use push/deep links to resume. */
export class MobileP2PLifecycle { constructor(private readonly adapter: MobileP2PAdapter) {} async onForeground(){ await this.adapter.resume(); } async onBackground(){ await this.adapter.suspend(); } async shutdown(){ await this.adapter.stop(); } }
