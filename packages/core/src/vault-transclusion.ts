/** Bounded, provenance-preserving Markdown embed/transclusion rendering. */
import type { MarkdownNote, VaultAttachment, VaultLinkReference, VaultService } from './vaults.js';

export const TRANSCLUSION_MAX_DEPTH = 8;
export const TRANSCLUSION_MAX_CHARACTERS = 100_000;

export type TransclusionFragmentKind = 'NOTE' | 'HEADING' | 'BLOCK' | 'ATTACHMENT' | 'MISSING' | 'CYCLE' | 'DEPTH_LIMIT' | 'INVALID';

export interface TransclusionProvenance {
  readonly vaultId: string;
  readonly noteId?: string;
  readonly path?: string;
  readonly heading?: string;
  readonly blockId?: string;
}

export interface TransclusionFragment {
  readonly id: string;
  readonly kind: TransclusionFragmentKind;
  readonly rendered: string;
  readonly provenance: TransclusionProvenance;
  readonly sourceNoteId?: string;
  readonly sourcePath?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly missing?: boolean;
  readonly cyclePath?: readonly string[];
  readonly children?: readonly TransclusionFragment[];
}

export interface TransclusionRender {
  readonly version: 1;
  readonly vaultId: string;
  readonly sourceNoteId: string;
  readonly sourcePath: string;
  readonly rendered: string;
  readonly fragments: readonly TransclusionFragment[];
  readonly truncated: boolean;
  readonly diagnostics: readonly string[];
}

export interface TransclusionRequest {
  readonly noteIdOrPath: string;
  readonly maxDepth?: number;
  readonly maxCharacters?: number;
  readonly actor?: string;
}

export class TransclusionError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'BOUNDS_EXCEEDED', message: string) { super(message); this.name = 'TransclusionError'; }
}

export class VaultTransclusionService {
  constructor(private readonly vault: VaultService) {}

  async render(request: TransclusionRequest | string, actor?: string): Promise<TransclusionRender> {
    const normalized = typeof request === 'string' ? { noteIdOrPath: request, actor } : request;
    const currentActor = normalized.actor ?? actor ?? this.vault.identityId;
    const maxDepth = clamp(normalized.maxDepth ?? TRANSCLUSION_MAX_DEPTH, 0, TRANSCLUSION_MAX_DEPTH);
    const maxCharacters = clamp(normalized.maxCharacters ?? TRANSCLUSION_MAX_CHARACTERS, 256, TRANSCLUSION_MAX_CHARACTERS);
    if (!normalized.noteIdOrPath.trim()) throw new TransclusionError('INVALID_ARGUMENT', 'A transclusion source note is required');
    const root = await this.vault.getNote(normalized.noteIdOrPath, currentActor);
    if (!root) throw new TransclusionError('NOT_FOUND', 'Transclusion source note was not found');
    const vault = await this.vault.getVault(currentActor);
    const diagnostics: string[] = [];
    let used = 0;
    const result = await this.renderNote(root, 0, [], maxDepth, maxCharacters, currentActor, diagnostics, () => used, value => { used = value; });
    return { version: 1, vaultId: vault.id, sourceNoteId: root.id, sourcePath: root.path, rendered: result.rendered.slice(0, maxCharacters), fragments: result.fragments, truncated: result.truncated || used > maxCharacters, diagnostics };
  }

  async renderFragment(noteIdOrPath: string, link: VaultLinkReference, options: Omit<TransclusionRequest, 'noteIdOrPath'> = {}): Promise<TransclusionFragment> {
    const source = await this.vault.getNote(noteIdOrPath, options.actor ?? this.vault.identityId); if (!source) throw new TransclusionError('NOT_FOUND', 'Transclusion source note was not found');
    const currentActor = options.actor ?? this.vault.identityId; const diagnostics: string[] = []; let used = 0;
    return this.resolveEmbed(link, source, 0, [], clamp(options.maxDepth ?? TRANSCLUSION_MAX_DEPTH, 0, TRANSCLUSION_MAX_DEPTH), clamp(options.maxCharacters ?? TRANSCLUSION_MAX_CHARACTERS, 256, TRANSCLUSION_MAX_CHARACTERS), currentActor, diagnostics, () => used, value => { used = value; });
  }

  /** Explicit source editing avoids ambiguous inline writes to a transclusion. */
  async editSource(noteId: string, content: string, baseRevision: number, actor = this.vault.identityId): Promise<MarkdownNote> { return this.vault.updateNote(noteId, { content, baseRevision }, actor); }

  private async renderNote(note: MarkdownNote, depth: number, stack: readonly string[], maxDepth: number, maxCharacters: number, actor: string, diagnostics: string[], getUsed: () => number, setUsed: (value: number) => void): Promise<{ rendered: string; fragments: TransclusionFragment[]; truncated: boolean }> {
    const links = note.links.filter(link => link.kind === 'embed');
    let rendered = note.body;
    const fragments: TransclusionFragment[] = [];
    let truncated = false;
    for (const link of links) {
      const fragment = await this.resolveEmbed(link, note, depth, stack, maxDepth, maxCharacters, actor, diagnostics, getUsed, setUsed);
      fragments.push(fragment);
      const replacement = fragment.rendered;
      const before = rendered.length;
      rendered = rendered.split(link.raw).join(replacement);
      if (rendered.length === before && link.raw.startsWith('!') === false) diagnostics.push(`Embed source text not found in ${note.path}:${link.line}`);
      if (getUsed() > maxCharacters) { truncated = true; break; }
    }
    if (rendered.length > maxCharacters) { rendered = rendered.slice(0, maxCharacters); truncated = true; }
    return { rendered, fragments, truncated };
  }

  private async resolveEmbed(link: VaultLinkReference, source: MarkdownNote, depth: number, stack: readonly string[], maxDepth: number, maxCharacters: number, actor: string, diagnostics: string[], getUsed: () => number, setUsed: (value: number) => void): Promise<TransclusionFragment> {
    const vault = await this.vault.getVault(actor);
    const sourceKey = `${source.id}:${link.target}:${link.heading ?? ''}:${link.blockId ?? ''}`;
    if (stack.includes(sourceKey)) { diagnostics.push(`Recursive embed cycle detected at ${source.path}`); return { id: `cycle:${sourceKey}`, kind: 'CYCLE', rendered: `[Embed cycle: ${link.target}]`, provenance: { vaultId: vault.id, noteId: source.id, path: source.path }, cyclePath: [...stack, sourceKey] }; }
    if (depth >= maxDepth) { diagnostics.push(`Embed depth limit reached at ${link.target}`); return { id: `depth:${sourceKey}`, kind: 'DEPTH_LIMIT', rendered: `[Embed depth limit: ${link.target}]`, provenance: { vaultId: vault.id, noteId: source.id, path: source.path }, missing: false }; }
    const targetNote = await this.vault.resolveNote(link.target, actor).catch(error => { if (error instanceof Error && error.message.includes('ambiguous')) { diagnostics.push(`Ambiguous embed: ${link.target}`); return undefined; } throw error; });
    if (targetNote) {
      const provenance: TransclusionProvenance = { vaultId: vault.id, noteId: targetNote.id, path: targetNote.path, ...(link.heading ? { heading: link.heading } : {}), ...(link.blockId ? { blockId: link.blockId } : {}) };
      const selected = selectFragment(targetNote, link);
      if (!selected) return { id: `missing-ref:${targetNote.id}`, kind: 'MISSING', rendered: `[Missing heading/block: ${link.target}]`, provenance, missing: true };
      if (selected !== targetNote && 'text' in selected) {
        return { id: `note:${targetNote.id}:${link.heading ?? ''}:${link.blockId ?? ''}`, kind: link.blockId ? 'BLOCK' : 'HEADING', rendered: consume(selected.text, maxCharacters, getUsed, setUsed), provenance, sourceNoteId: targetNote.id, sourcePath: targetNote.path };
      }
      const nested = await this.renderNote(targetNote, depth + 1, [...stack, sourceKey], maxDepth, maxCharacters, actor, diagnostics, getUsed, setUsed);
      return { id: `note:${targetNote.id}`, kind: 'NOTE', rendered: nested.rendered, provenance, sourceNoteId: targetNote.id, sourcePath: targetNote.path, ...(nested.fragments.length ? { children: nested.fragments } : {}) };
    }
    const attachmentTarget = link.targetPath ?? link.target.replace(/^\.\//, '');
    const attachment = await this.vault.getAttachment(attachmentTarget, actor).catch(() => undefined);
    if (attachment) return this.attachmentFragment(attachment, vault.id, source, link);
    diagnostics.push(`Missing embed: ${link.target}`);
    return { id: `missing:${link.target}`, kind: 'MISSING', rendered: `[Missing embed: ${link.target}]`, provenance: { vaultId: vault.id, noteId: source.id, path: source.path }, missing: true };
  }

  private attachmentFragment(attachment: VaultAttachment, vaultId: string, source: MarkdownNote, link: VaultLinkReference): TransclusionFragment { const image = attachment.mimeType.startsWith('image/'); return { id: `attachment:${attachment.id}`, kind: attachment.missing ? 'MISSING' : 'ATTACHMENT', rendered: attachment.missing ? `[Missing attachment: ${attachment.path}]` : image ? `![${attachment.name}](${attachment.path})` : `[${attachment.name}](${attachment.path})`, provenance: { vaultId, noteId: source.id, path: source.path }, sourcePath: attachment.path, mimeType: attachment.mimeType, size: attachment.size, missing: attachment.missing }; }
}

function selectFragment(note: MarkdownNote, link: VaultLinkReference): MarkdownNote | { readonly text: string } | undefined {
  if (!link.heading && !link.blockId) return note;
  const lines = note.body.split('\n');
  if (link.blockId) { const index = lines.findIndex(line => new RegExp(`\\^${escapeRegExp(link.blockId!)}\\b`).test(line)); if (index < 0) return undefined; return { text: lines[index]!.replace(new RegExp(`\\s*\\^${escapeRegExp(link.blockId!)}\\b`), '').trim() }; }
  const headingIndex = note.headings.findIndex(heading => heading.id === slug(link.heading!) || heading.text === link.heading); if (headingIndex < 0) return undefined; const heading = note.headings[headingIndex]!; const start = Math.max(0, heading.line - 1); const endHeading = note.headings.slice(headingIndex + 1).find(next => next.level <= heading.level); const end = endHeading ? Math.max(start + 1, endHeading.line - 1) : lines.length; return { text: lines.slice(start, end).join('\n') };
}
function consume(value: string, maxCharacters: number, getUsed: () => number, setUsed: (value: number) => void): string { const remaining = Math.max(0, maxCharacters - getUsed()); const output = value.slice(0, remaining); setUsed(getUsed() + output.length); return output; }
function slug(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 120) || 'heading'; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min; }
