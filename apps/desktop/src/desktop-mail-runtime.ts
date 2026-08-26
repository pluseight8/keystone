/** Typed desktop host boundary for R0P83 External Email.
 *
 * The shell receives local projections only. A host adapter may back this
 * interface with MailService and an encrypted local store, but the UI never
 * receives provider credentials, raw sockets, or a generic relay handle.
 */
export type DesktopMailFolderRole = 'INBOX' | 'SENT' | 'DRAFTS' | 'ARCHIVE' | 'SPAM' | 'TRASH' | 'CUSTOM';
export type DesktopMailFlag = 'SEEN' | 'STARRED' | 'ANSWERED' | 'DRAFT' | 'DELETED' | 'JUNK';
export type DesktopMailSendState = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';

export interface DesktopMailAddress { readonly name?: string; readonly address: string; }
export interface DesktopMailAccount { readonly id: string; readonly label: string; readonly address: DesktopMailAddress; readonly providerKind: 'IMAP_SMTP' | 'JMAP' | 'CONTROLLED'; readonly enabled: boolean; readonly attention?: string; readonly lastSuccessfulSync?: string; }
export interface DesktopMailFolder { readonly id: string; readonly accountId: string; readonly name: string; readonly role: DesktopMailFolderRole; readonly unreadCount?: number; }
export interface DesktopMailAttachment { readonly id: string; readonly filename: string; readonly mimeType: string; readonly sizeBytes: number; readonly contentAvailable: boolean; readonly privateByDefault: true; }
export interface DesktopMailMessage { readonly id: string; readonly accountId: string; readonly folderId: string; readonly folderRole?: DesktopMailFolderRole; readonly from: DesktopMailAddress; readonly to: readonly DesktopMailAddress[]; readonly cc: readonly DesktopMailAddress[]; readonly subject: string; readonly snippet: string; readonly bodyText?: string; readonly bodyHtml?: string; readonly flags: readonly DesktopMailFlag[]; readonly receivedAt: string; readonly attachments: readonly DesktopMailAttachment[]; readonly contentState: 'METADATA' | 'CACHED' | 'PARTIAL'; readonly externalImageUrls: readonly string[]; }
export interface DesktopMailThread { readonly id: string; readonly accountId: string; readonly subject: string; readonly messageIds: readonly string[]; readonly unreadCount: number; readonly participants: readonly DesktopMailAddress[]; readonly updatedAt: string; }
export interface DesktopMailDraft { readonly id: string; readonly accountId: string; readonly to: readonly DesktopMailAddress[]; readonly cc: readonly DesktopMailAddress[]; readonly bcc: readonly DesktopMailAddress[]; readonly subject: string; readonly bodyText: string; readonly status: 'DRAFT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN'; readonly attachmentIds: readonly string[]; }
export interface DesktopMailOutboxEntry { readonly id: string; readonly draftId: string; readonly state: DesktopMailSendState; readonly attempts: number; readonly lastError?: string; readonly stableMessageId: string; }
export interface DesktopMailRenderedBody { readonly mode: 'TEXT' | 'SANITIZED_HTML'; readonly value: string; readonly blockedExternalImages: readonly string[]; readonly safeLinks: readonly { readonly url: string; readonly label: string }[]; }

export interface DesktopMailRuntime {
  accounts(): Promise<readonly DesktopMailAccount[]> | readonly DesktopMailAccount[];
  folders(accountId?: string): Promise<readonly DesktopMailFolder[]> | readonly DesktopMailFolder[];
  messages(input?: { readonly accountId?: string; readonly folderId?: string; readonly unreadOnly?: boolean; readonly limit?: number }): Promise<readonly DesktopMailMessage[]>;
  threads?(accountId?: string): Promise<readonly DesktopMailThread[]> | readonly DesktopMailThread[];
  search?(query: string, input?: { readonly accountId?: string; readonly limit?: number }): Promise<readonly { readonly id: string; readonly kind: 'mail' | 'mail-thread'; readonly title: string; readonly snippet: string }[]> | readonly { readonly id: string; readonly kind: 'mail' | 'mail-thread'; readonly title: string; readonly snippet: string }[];
  render?(messageId: string, options?: { readonly allowExternalImages?: boolean }): DesktopMailRenderedBody;
  refresh?(accountId: string): Promise<void>;
  createDraft(input: { readonly accountId: string; readonly to?: readonly DesktopMailAddress[]; readonly cc?: readonly DesktopMailAddress[]; readonly bcc?: readonly DesktopMailAddress[]; readonly subject?: string; readonly bodyText?: string }): Promise<DesktopMailDraft>;
  updateDraft?(draftId: string, patch: Partial<Pick<DesktopMailDraft, 'to' | 'cc' | 'bcc' | 'subject' | 'bodyText'>>): Promise<DesktopMailDraft>;
  drafts?(accountId?: string): Promise<readonly DesktopMailDraft[]> | readonly DesktopMailDraft[];
  reply?(messageId: string, all?: boolean): Promise<DesktopMailDraft>;
  forward?(messageId: string, to?: readonly DesktopMailAddress[]): Promise<DesktopMailDraft>;
  send?(draftId: string, ownerConfirmed: boolean): Promise<DesktopMailOutboxEntry>;
  outbox?(accountId?: string): Promise<readonly DesktopMailOutboxEntry[]> | readonly DesktopMailOutboxEntry[];
  markRead?(messageId: string, read?: boolean): Promise<void>;
  setStarred?(messageId: string, starred?: boolean): Promise<void>;
  move?(messageId: string, folderId: string): Promise<void>;
  delete?(messageId: string): Promise<void>;
  downloadAttachment?(messageId: string, attachmentId: string): Promise<{ readonly filename: string; readonly bytes: Uint8Array }>;
  saveAttachment?(messageId: string, attachmentId: string): Promise<{ readonly fileId: string }>;
  setExternalImagePolicy?(policy: 'BLOCK_BY_DEFAULT' | 'ALLOW_EXPLICIT'): Promise<void>;
  openExternal?(url: string): Promise<void>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopMailRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopMailRuntime(runtime: DesktopMailRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopMailRuntime(): DesktopMailRuntime | undefined { return current; }
export function subscribeDesktopMailRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
