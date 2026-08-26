/** Mobile host boundary for R0P83 External Email.
 * No provider credential, raw socket or mailbox transport is exposed to the
 * React Native surface; the native/bootstrap host installs this projection.
 */
export type MobileMailFolderRole = 'INBOX' | 'SENT' | 'DRAFTS' | 'ARCHIVE' | 'SPAM' | 'TRASH' | 'CUSTOM';
export type MobileMailFlag = 'SEEN' | 'STARRED' | 'ANSWERED' | 'DRAFT' | 'DELETED' | 'JUNK';
export type MobileMailSendState = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
export interface MobileMailAddress { readonly name?: string; readonly address: string; }
export interface MobileMailAccount { readonly id: string; readonly label: string; readonly address: MobileMailAddress; readonly providerKind: 'IMAP_SMTP' | 'JMAP' | 'CONTROLLED'; readonly enabled: boolean; readonly attention?: string; }
export interface MobileMailFolder { readonly id: string; readonly accountId: string; readonly name: string; readonly role: MobileMailFolderRole; readonly unreadCount?: number; }
export interface MobileMailAttachment { readonly id: string; readonly filename: string; readonly mimeType: string; readonly sizeBytes: number; readonly contentAvailable: boolean; readonly privateByDefault: true; }
export interface MobileMailMessage { readonly id: string; readonly accountId: string; readonly folderId: string; readonly from: MobileMailAddress; readonly to: readonly MobileMailAddress[]; readonly cc: readonly MobileMailAddress[]; readonly subject: string; readonly snippet: string; readonly bodyText?: string; readonly bodyHtml?: string; readonly flags: readonly MobileMailFlag[]; readonly receivedAt: string; readonly attachments: readonly MobileMailAttachment[]; readonly contentState: 'METADATA' | 'CACHED' | 'PARTIAL'; readonly externalImageUrls: readonly string[]; }
export interface MobileMailDraft { readonly id: string; readonly accountId: string; readonly to: readonly MobileMailAddress[]; readonly cc: readonly MobileMailAddress[]; readonly bcc: readonly MobileMailAddress[]; readonly subject: string; readonly bodyText: string; readonly status: 'DRAFT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN'; }
export interface MobileMailOutboxEntry { readonly id: string; readonly draftId: string; readonly state: MobileMailSendState; readonly attempts: number; readonly lastError?: string; }
export interface MobileMailRenderedBody { readonly mode: 'TEXT' | 'SANITIZED_HTML'; readonly value: string; readonly blockedExternalImages: readonly string[]; }
export interface MobileMailRuntime {
  accounts(): Promise<readonly MobileMailAccount[]> | readonly MobileMailAccount[];
  folders(accountId?: string): Promise<readonly MobileMailFolder[]> | readonly MobileMailFolder[];
  messages(input?: { readonly accountId?: string; readonly folderId?: string; readonly unreadOnly?: boolean; readonly limit?: number }): Promise<readonly MobileMailMessage[]>;
  search?(query: string, input?: { readonly accountId?: string; readonly limit?: number }): Promise<readonly { readonly id: string; readonly title: string; readonly snippet: string }[]> | readonly { readonly id: string; readonly title: string; readonly snippet: string }[];
  render?(messageId: string): MobileMailRenderedBody;
  refresh?(accountId: string): Promise<void>;
  createDraft(input: { readonly accountId: string; readonly to?: readonly MobileMailAddress[]; readonly subject?: string; readonly bodyText?: string }): Promise<MobileMailDraft>;
  updateDraft?(draftId: string, patch: Partial<Pick<MobileMailDraft, 'to' | 'subject' | 'bodyText'>>): Promise<MobileMailDraft>;
  reply?(messageId: string, all?: boolean): Promise<MobileMailDraft>;
  forward?(messageId: string, to?: readonly MobileMailAddress[]): Promise<MobileMailDraft>;
  send?(draftId: string, ownerConfirmed: boolean): Promise<MobileMailOutboxEntry>;
  outbox?(accountId?: string): Promise<readonly MobileMailOutboxEntry[]> | readonly MobileMailOutboxEntry[];
  markRead?(messageId: string, read?: boolean): Promise<void>;
  setStarred?(messageId: string, starred?: boolean): Promise<void>;
  delete?(messageId: string): Promise<void>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileMailRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileMailRuntime(runtime: MobileMailRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileMailRuntime(): MobileMailRuntime | undefined { return current; }
export function subscribeMobileMailRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
