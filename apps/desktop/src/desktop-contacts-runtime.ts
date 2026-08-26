/** Typed desktop host boundary for R0P92 Contacts.
 *
 * The renderer receives only bounded, non-private projections.  ContactService
 * remains the single source of truth for owner data, persistence, sharing and
 * identity-link policy.
 */
import {
  ContactService,
  type ContactAddress,
  type ContactCardOptions,
  type ContactGroup,
  type ContactId,
  type ContactImportPreview,
  type ContactImportSummary,
  type ContactName,
  type ContactQuery,
  type ContactRecord,
  type ContactShareCard,
  type ContactWebsite,
  type CreateContactInput,
  type UpdateContactInput,
} from '@keystone/core';

export interface DesktopContact {
  readonly id: ContactId;
  readonly kind: ContactRecord['kind'];
  readonly displayName: string;
  readonly name: ContactName;
  readonly emails: readonly Pick<ContactRecord['emails'][number], 'id' | 'value' | 'label' | 'preferred'>[];
  readonly phones: readonly Pick<ContactRecord['phones'][number], 'id' | 'value' | 'label' | 'preferred'>[];
  readonly addresses: readonly Pick<ContactAddress, 'id' | 'label' | 'formatted' | 'street' | 'locality' | 'region' | 'country'>[];
  readonly websites: readonly Pick<ContactWebsite, 'id' | 'label' | 'url'>[];
  readonly organization?: ContactRecord['organization'];
  readonly dates: ContactRecord['dates'];
  readonly tags: readonly string[];
  readonly groupIds: ContactRecord['groupIds'];
  readonly favorite: boolean;
  readonly avatarUri?: string;
  readonly linkedIdentityIds: readonly string[];
  readonly updatedAt: string;
}

export interface DesktopContactPage {
  readonly items: readonly DesktopContact[];
  readonly total: number;
  readonly nextCursor?: string;
}

export interface DesktopContactGroup {
  readonly id: ContactGroup['id'];
  readonly name: string;
  readonly description?: string;
  readonly contactCount: number;
  readonly updatedAt: string;
}

export interface DesktopContactsRuntime {
  contacts(options?: ContactQuery): Promise<DesktopContactPage>;
  search(query: string, options?: Omit<ContactQuery, 'query'>): Promise<DesktopContactPage>;
  groups(): Promise<readonly DesktopContactGroup[]>;
  create(input: CreateContactInput): Promise<DesktopContact>;
  update(contactId: ContactId | string, patch: UpdateContactInput): Promise<DesktopContact>;
  favorite(contactId: ContactId | string, value: boolean): Promise<DesktopContact>;
  trash(contactId: ContactId | string): Promise<DesktopContact>;
  restore(contactId: ContactId | string): Promise<DesktopContact>;
  createCard(contactId: ContactId | string, options?: ContactCardOptions): Promise<ContactShareCard>;
  previewVCard(input: string | Uint8Array): Promise<ContactImportPreview>;
  importVCard(input: string | Uint8Array): Promise<ContactImportSummary>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopContactsRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopContactsRuntime(runtime: DesktopContactsRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopContactsRuntime(): DesktopContactsRuntime | undefined { return current; }
export function subscribeDesktopContactsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createDesktopContactsRuntime(service: ContactService): DesktopContactsRuntime {
  const project = (contact: ContactRecord): DesktopContact => ({
    id: contact.id,
    kind: contact.kind,
    displayName: contact.displayName,
    name: contact.name,
    emails: contact.emails.map(value => ({ id: value.id, value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })),
    phones: contact.phones.map(value => ({ id: value.id, value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })),
    addresses: contact.addresses.map(value => ({ id: value.id, ...(value.label ? { label: value.label } : {}), ...(value.formatted ? { formatted: value.formatted } : {}), ...(value.street ? { street: value.street } : {}), ...(value.locality ? { locality: value.locality } : {}), ...(value.region ? { region: value.region } : {}), ...(value.country ? { country: value.country } : {}) })),
    websites: contact.websites.map(value => ({ id: value.id, ...(value.label ? { label: value.label } : {}), url: value.url })),
    ...(contact.organization ? { organization: contact.organization } : {}),
    dates: contact.dates,
    tags: contact.tags,
    groupIds: contact.groupIds,
    favorite: contact.favorite,
    ...(contact.avatar ? { avatarUri: contact.avatar.uri } : {}),
    linkedIdentityIds: contact.identityLinks.filter(value => value.state === 'LINKED').map(value => value.identityId),
    updatedAt: contact.updatedAt,
  });
  const page = async (promise: ReturnType<ContactService['listContacts']>): Promise<DesktopContactPage> => { const result = await promise; return { ...result, items: result.items.map(project) }; };
  const contacts = (options: ContactQuery = {}) => { const { query, ...filters } = options; return query?.trim() ? page(service.searchContacts(query, filters)) : page(service.listContacts(filters)); };
  const groups = async (): Promise<readonly DesktopContactGroup[]> => (await service.listGroups()).map(group => ({ id: group.id, name: group.name, ...(group.description ? { description: group.description } : {}), contactCount: group.contactIds.length, updatedAt: group.updatedAt }));
  return {
    contacts,
    search: (query, options) => page(service.searchContacts(query, { ...options, includePrivateNotes: false })),
    groups,
    create: async input => project(await service.createContact(input)),
    update: async (contactId, patch) => project(await service.updateContact(contactId, patch)),
    favorite: async (contactId, value) => project(await service.setFavorite(contactId, value)),
    trash: async contactId => project(await service.deleteContact(contactId)),
    restore: async contactId => project(await service.restoreContact(contactId)),
    createCard: (contactId, options) => service.createContactCard(contactId, options),
    previewVCard: input => service.previewVCard(input),
    importVCard: input => service.importVCard(input, { ownerConfirmed: true }),
    subscribe: listener => service.subscribe(() => listener()),
  };
}
