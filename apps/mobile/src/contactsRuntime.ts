/** Mobile host boundary for R0P92 Contacts.
 *
 * Only bounded non-private projections cross into the screen.  The native host
 * installs the single core ContactService; this module never invents a second
 * address-book store or an implicit identity/contact import path.
 */
import type {
  ContactAddress,
  ContactCardOptions,
  ContactGroup,
  ContactId,
  ContactName,
  ContactQuery,
  ContactRecord,
  ContactService,
  ContactShareCard,
  ContactWebsite,
  CreateContactInput,
  UpdateContactInput,
} from '@keystone/core';

export interface MobileContact {
  readonly id: ContactId;
  readonly kind: ContactRecord['kind'];
  readonly displayName: string;
  readonly name: ContactName;
  readonly emails: readonly Pick<ContactRecord['emails'][number], 'id' | 'value' | 'label' | 'preferred'>[];
  readonly phones: readonly Pick<ContactRecord['phones'][number], 'id' | 'value' | 'label' | 'preferred'>[];
  readonly addresses: readonly Pick<ContactAddress, 'id' | 'label' | 'formatted'>[];
  readonly websites: readonly Pick<ContactWebsite, 'id' | 'label' | 'url'>[];
  readonly organization?: ContactRecord['organization'];
  readonly tags: readonly string[];
  readonly favorite: boolean;
  readonly linkedIdentityIds: readonly string[];
}

export interface MobileContactPage { readonly items: readonly MobileContact[]; readonly total: number; readonly nextCursor?: string; }
export interface MobileContactGroup { readonly id: ContactGroup['id']; readonly name: string; readonly contactCount: number; }

export interface MobileContactsRuntime {
  contacts(options?: ContactQuery): Promise<MobileContactPage>;
  search(query: string, options?: Omit<ContactQuery, 'query'>): Promise<MobileContactPage>;
  groups(): Promise<readonly MobileContactGroup[]>;
  create(input: CreateContactInput): Promise<MobileContact>;
  update(contactId: ContactId | string, patch: UpdateContactInput): Promise<MobileContact>;
  favorite(contactId: ContactId | string, value: boolean): Promise<MobileContact>;
  trash(contactId: ContactId | string): Promise<MobileContact>;
  restore(contactId: ContactId | string): Promise<MobileContact>;
  createCard(contactId: ContactId | string, options?: ContactCardOptions): Promise<ContactShareCard>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileContactsRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileContactsRuntime(runtime: MobileContactsRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getMobileContactsRuntime(): MobileContactsRuntime | undefined { return current; }
export function subscribeMobileContactsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createMobileContactsRuntime(service: ContactService): MobileContactsRuntime {
  const project = (contact: ContactRecord): MobileContact => ({
    id: contact.id,
    kind: contact.kind,
    displayName: contact.displayName,
    name: contact.name,
    emails: contact.emails.map(value => ({ id: value.id, value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })),
    phones: contact.phones.map(value => ({ id: value.id, value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })),
    addresses: contact.addresses.map(value => ({ id: value.id, ...(value.label ? { label: value.label } : {}), ...(value.formatted ? { formatted: value.formatted } : {}) })),
    websites: contact.websites.map(value => ({ id: value.id, ...(value.label ? { label: value.label } : {}), url: value.url })),
    ...(contact.organization ? { organization: contact.organization } : {}),
    tags: contact.tags,
    favorite: contact.favorite,
    linkedIdentityIds: contact.identityLinks.filter(value => value.state === 'LINKED').map(value => value.identityId),
  });
  const page = async (promise: ReturnType<ContactService['listContacts']>): Promise<MobileContactPage> => { const result = await promise; return { ...result, items: result.items.map(project) }; };
  const contacts = (options: ContactQuery = {}) => { const { query, ...filters } = options; return query?.trim() ? page(service.searchContacts(query, filters)) : page(service.listContacts(filters)); };
  return {
    contacts,
    search: (query, options) => page(service.searchContacts(query, { ...options, includePrivateNotes: false })),
    groups: async () => (await service.listGroups()).map(group => ({ id: group.id, name: group.name, contactCount: group.contactIds.length })),
    create: async input => project(await service.createContact(input)),
    update: async (contactId, patch) => project(await service.updateContact(contactId, patch)),
    favorite: async (contactId, value) => project(await service.setFavorite(contactId, value)),
    trash: async contactId => project(await service.deleteContact(contactId)),
    restore: async contactId => project(await service.restoreContact(contactId)),
    createCard: (contactId, options) => service.createContactCard(contactId, options),
    subscribe: listener => service.subscribe(() => listener()),
  };
}
