/**
 * R0P92 People, Contacts and Personal Address Book.
 *
 * A Contact is owner-maintained address-book data.  It is deliberately not a
 * Keystone Identity, Profile, mail account, network endpoint or authorization
 * principal.  The service is local-first; owner-device replication and
 * provider integrations are narrow typed adapters around this store.
 */
import type { MailAddress, MailContactsAdapter } from './mail.js';
import type { NearbyContactExchangeObject, NearbyContactField } from './nearby-exchange.js';
import type { NodeId } from './types.js';

export const CONTACTS_PROTOCOL = 'keystone.contacts.r0p92' as const;
export const CONTACTS_VERSION = 1 as const;

export const CONTACTS_MAX_CONTACTS = 100_000;
export const CONTACTS_MAX_GROUPS = 10_000;
export const CONTACTS_MAX_EMAILS = 32;
export const CONTACTS_MAX_PHONES = 32;
export const CONTACTS_MAX_ADDRESSES = 32;
export const CONTACTS_MAX_WEBSITES = 32;
export const CONTACTS_MAX_DATES = 32;
export const CONTACTS_MAX_TAGS = 64;
export const CONTACTS_MAX_EXTERNAL_HANDLES = 32;
export const CONTACTS_MAX_GROUP_MEMBERS = 100_000;
export const CONTACTS_MAX_PAGE = 256;
export const CONTACTS_MAX_SEARCH_TOKENS = 32;
export const CONTACTS_MAX_DUPLICATE_CANDIDATES = 50_000;
export const CONTACTS_MAX_REDIRECTS = 100_000;
export const CONTACTS_MAX_EVENTS = 16_384;
export const CONTACTS_MAX_NAME_BYTES = 512;
export const CONTACTS_MAX_TEXT_BYTES = 64 * 1024;
export const CONTACTS_MAX_URL_BYTES = 2_048;
export const CONTACTS_MAX_AVATAR_BYTES = 1 * 1024 * 1024;
export const CONTACTS_MAX_VCARD_BYTES = 8 * 1024 * 1024;
export const CONTACTS_MAX_VCARD_CARDS = 10_000;
export const CONTACTS_MAX_VCARD_LINE_BYTES = 16 * 1024;
export const CONTACTS_MAX_VCARD_PROPERTIES = 512;
export const CONTACTS_MAX_VCARD_VALUE_BYTES = 64 * 1024;
export const CONTACTS_MAX_VCARD_PHOTO_BYTES = 1 * 1024 * 1024;
export const CONTACTS_MAX_CSV_BYTES = 8 * 1024 * 1024;
export const CONTACTS_MAX_CSV_ROWS = 10_000;
export const CONTACTS_MAX_CSV_COLUMNS = 128;
export const CONTACTS_MAX_CSV_FIELD_BYTES = 64 * 1024;
export const CONTACTS_MAX_CARD_BYTES = 64 * 1024;
export const CONTACTS_MAX_CARD_FIELDS = 16;

const CONTACT_INPUT_PROVENANCE = Symbol('contact-input-provenance');

/** Machine-readable guards used by architecture/security tests. */
export const CONTACTS_ARCHITECTURE_POLICY = Object.freeze({
  centralContactsServerDependency: 0,
  mandatoryGoogleContactsDependency: 0,
  mandatoryIcloudContactsDependency: 0,
  mandatoryMicrosoftAccountDependency: 0,
  cardDavCoreImplementation: 0,
  calDavCoreImplementation: 0,
  contactAsAuthorizationPrincipal: 0,
  emailToIdentityAutomaticTrust: 0,
  phoneToIdentityAutomaticTrust: 0,
  displayNameToIdentityAutomaticLink: 0,
  mailSenderAutomaticContactCreation: 0,
  messageSenderAutomaticContactCreation: 0,
  nearbyAutomaticContactCreation: 0,
  relayAutomaticContactCreation: 0,
  feedAuthorAutomaticContactCreation: 0,
  photoFaceContactMatching: 0,
  faceRecognition: 0,
  relationshipInference: 0,
  friendshipScoring: 0,
  communicationFrequencyRanking: 0,
  contactGroupAutomaticSecurityGroup: 0,
  contactGroupFolderAuthorization: 0,
  contactGroupSpaceMembership: 0,
  contactLinkTaskListAuthorization: 0,
  externalAiImplicitContactContext: 0,
  automaticPersonalMemoryIngestion: 0,
  pluginImplicitFullContactsAccess: 0,
  webpageContactsEnumeration: 0,
  automaticExternalGeocoding: 0,
  contactAddressCurrentLocationPermission: 0,
  privateNotesDefaultShare: 0,
  timerPerContact: 0,
  listenerPerContact: 0,
  legacyBypass: 0,
  directApplicationBypassAllowed: false,
  silentLegacyFallbackAllowed: false,
} as const);

export type ContactId = string & { readonly __contactId: unique symbol };
export type ContactGroupId = string & { readonly __contactGroupId: unique symbol };
export type ContactFieldId = string & { readonly __contactFieldId: unique symbol };
export type ContactCardId = string & { readonly __contactCardId: unique symbol };
export type ContactImportId = string & { readonly __contactImportId: unique symbol };

export type ContactKind = 'PERSON' | 'ORGANIZATION';
export type ContactIdentityLinkState = 'UNLINKED' | 'SUGGESTED' | 'LINKED' | 'STALE_REVOKED';
export type ContactIdentityLinkProvenance = 'OWNER_CONFIRMED' | 'VERIFIED_EXCHANGE' | 'PROFILE_EXCHANGE';
export type ContactFieldProvenance = 'OWNER_ENTERED' | 'IMPORTED_VCARD' | 'IMPORTED_CSV' | 'NEARBY_CARD' | 'PROFILE';
export type ContactAvatarSource = 'LOCAL_OVERRIDE' | 'PROFILE' | 'IMPORTED_VCARD' | 'PHOTO_LIBRARY';
export type ContactDateKind = 'BIRTHDAY' | 'ANNIVERSARY' | 'CUSTOM';
export type ContactExternalHandleKind = 'EMAIL' | 'PHONE' | 'USERNAME' | 'URI';

export interface ContactName {
  readonly displayName?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly middleName?: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly nickname?: string;
}

export interface ContactEmail {
  readonly version: 1;
  readonly id: ContactFieldId;
  readonly value: string;
  /** Conservative normalization: the domain is case-folded; provider tricks are not applied. */
  readonly normalized: string;
  readonly label?: string;
  readonly preferred: boolean;
  readonly provenance: ContactFieldProvenance;
  readonly verified?: boolean;
}

export interface ContactPhone {
  readonly version: 1;
  readonly id: ContactFieldId;
  readonly value: string;
  /** E.164-like value when the entered value contains a country-qualified number; otherwise local:… key. */
  readonly normalized: string;
  readonly label?: string;
  readonly preferred: boolean;
  readonly provenance: ContactFieldProvenance;
}

export interface ContactAddress {
  readonly version: 1;
  readonly id: ContactFieldId;
  readonly label?: string;
  readonly street?: string;
  readonly locality?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly country?: string;
  readonly formatted?: string;
  readonly provenance: ContactFieldProvenance;
}

export interface ContactWebsite {
  readonly version: 1;
  readonly id: ContactFieldId;
  readonly label?: string;
  readonly url: string;
  readonly provenance: ContactFieldProvenance;
}

export interface ContactOrganization {
  readonly name?: string;
  readonly department?: string;
  readonly jobTitle?: string;
}

export interface ContactDate {
  readonly version: 1;
  readonly id: ContactFieldId;
  readonly kind: ContactDateKind;
  readonly label?: string;
  readonly month: number;
  readonly day: number;
  /** Omitted for a yearless date.  A fake year is never generated. */
  readonly year?: number;
  readonly provenance: ContactFieldProvenance;
}

export interface ContactAvatar {
  readonly version: 1;
  readonly source: ContactAvatarSource;
  /** A content reference or bounded image data URI; never an executable path. */
  readonly uri: string;
  readonly mimeType?: string;
  readonly contentId?: string;
}

export interface ContactProfileRef {
  readonly version: 1;
  readonly identityId: NodeId;
  readonly displayName?: string;
  readonly bio?: string;
  readonly avatarUri?: string;
  readonly publicLinks?: readonly ContactWebsite[];
  readonly revision: number;
  readonly updatedAt: string;
}

export interface ContactIdentityProof {
  readonly version: 1;
  readonly identityId: NodeId;
  readonly publicKey?: string;
  readonly source: 'CANONICAL_IDENTITY' | 'OWNER_CONFIRMED';
  readonly signature?: string;
}

export interface ContactIdentityLink {
  readonly version: 1;
  readonly id: ContactFieldId;
  readonly identityId: NodeId;
  readonly state: ContactIdentityLinkState;
  readonly provenance: ContactIdentityLinkProvenance;
  readonly verified: boolean;
  readonly proof?: ContactIdentityProof;
  readonly linkedAt: string;
  readonly linkedBy: NodeId;
  readonly updatedAt: string;
}

export interface ContactExternalHandle {
  readonly version: 1;
  readonly id: ContactFieldId;
  readonly kind: ContactExternalHandleKind;
  readonly value: string;
  readonly normalized?: string;
  readonly label?: string;
  readonly provenance: ContactFieldProvenance;
}

export interface ContactRecord {
  readonly version: 1;
  readonly protocol: typeof CONTACTS_PROTOCOL;
  readonly id: ContactId;
  readonly ownerIdentityId: NodeId;
  readonly kind: ContactKind;
  readonly name: ContactName;
  readonly displayName: string;
  /** Set only when the owner intentionally overrides Profile presentation. */
  readonly displayNameOverride?: string;
  readonly emails: readonly ContactEmail[];
  readonly phones: readonly ContactPhone[];
  readonly addresses: readonly ContactAddress[];
  readonly websites: readonly ContactWebsite[];
  readonly organization?: ContactOrganization;
  readonly dates: readonly ContactDate[];
  /** Private owner data. It is excluded from cards and exports by default. */
  readonly notes?: string;
  readonly tags: readonly string[];
  readonly groupIds: readonly ContactGroupId[];
  readonly favorite: boolean;
  readonly avatar?: ContactAvatar;
  readonly profile?: ContactProfileRef;
  readonly identityLinks: readonly ContactIdentityLink[];
  readonly externalHandles: readonly ContactExternalHandle[];
  /** Imported vCard UIDs remain data, not authority. */
  readonly sourceUids: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly tombstone: boolean;
  readonly deletedAt?: string;
  /** Present for an explicit merge tombstone. */
  readonly mergedInto?: ContactId;
}

export type ContactEmailInput = Omit<Partial<ContactEmail>, 'version' | 'normalized' | 'provenance' | 'id'> & { readonly id?: string; readonly value: string };
export type ContactPhoneInput = Omit<Partial<ContactPhone>, 'version' | 'normalized' | 'provenance' | 'id'> & { readonly id?: string; readonly value: string; readonly region?: string };
export type ContactAddressInput = Omit<Partial<ContactAddress>, 'version' | 'provenance' | 'id'> & { readonly id?: string };
export type ContactWebsiteInput = Omit<Partial<ContactWebsite>, 'version' | 'provenance' | 'id'> & { readonly id?: string; readonly url: string };
export type ContactDateInput = Omit<Partial<ContactDate>, 'version' | 'provenance' | 'id'> & { readonly id?: string; readonly month: number; readonly day: number };
export type ContactExternalHandleInput = Omit<Partial<ContactExternalHandle>, 'version' | 'provenance' | 'id'> & { readonly id?: string; readonly kind: ContactExternalHandleKind; readonly value: string };

export interface ContactAvatarInput {
  readonly source?: ContactAvatarSource;
  readonly uri: string;
  readonly mimeType?: string;
  readonly contentId?: string;
}

export interface ContactIdentityLinkInput {
  readonly identityId: NodeId;
  readonly provenance?: ContactIdentityLinkProvenance;
  readonly proof?: ContactIdentityProof;
}

export interface ContactProfileInput {
  readonly identityId: NodeId;
  readonly displayName?: string;
  readonly bio?: string;
  readonly avatarUri?: string;
  readonly publicLinks?: readonly ContactWebsiteInput[];
  readonly revision?: number;
  readonly updatedAt?: string;
}

export interface CreateContactInput {
  readonly id?: ContactId | string;
  readonly kind?: ContactKind;
  readonly name?: ContactName;
  readonly displayName?: string;
  readonly displayNameOverride?: string;
  readonly emails?: readonly ContactEmailInput[];
  readonly phones?: readonly ContactPhoneInput[];
  readonly addresses?: readonly ContactAddressInput[];
  readonly websites?: readonly ContactWebsiteInput[];
  readonly organization?: ContactOrganization;
  readonly dates?: readonly ContactDateInput[];
  readonly birthday?: ContactDateInput | string;
  readonly notes?: string;
  readonly tags?: readonly string[];
  readonly groupIds?: readonly (ContactGroupId | string)[];
  readonly favorite?: boolean;
  readonly avatar?: ContactAvatarInput;
  readonly profile?: ContactProfileInput;
  readonly identityLinks?: readonly ContactIdentityLinkInput[];
  readonly externalHandles?: readonly ContactExternalHandleInput[];
  readonly sourceUids?: readonly string[];
}

export interface UpdateContactInput {
  readonly kind?: ContactKind;
  readonly name?: ContactName;
  readonly displayName?: string;
  readonly displayNameOverride?: string | null;
  readonly emails?: readonly ContactEmailInput[];
  readonly phones?: readonly ContactPhoneInput[];
  readonly addresses?: readonly ContactAddressInput[];
  readonly websites?: readonly ContactWebsiteInput[];
  readonly organization?: ContactOrganization | null;
  readonly dates?: readonly ContactDateInput[];
  readonly birthday?: ContactDateInput | string | null;
  readonly notes?: string | null;
  readonly tags?: readonly string[];
  readonly groupIds?: readonly (ContactGroupId | string)[];
  readonly favorite?: boolean;
  readonly avatar?: ContactAvatarInput | null;
  readonly externalHandles?: readonly ContactExternalHandleInput[];
}

export interface ContactGroup {
  readonly version: 1;
  readonly protocol: typeof CONTACTS_PROTOCOL;
  readonly id: ContactGroupId;
  readonly ownerIdentityId: NodeId;
  readonly name: string;
  readonly description?: string;
  readonly contactIds: readonly ContactId[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly tombstone: boolean;
}

export interface CreateContactGroupInput { readonly id?: ContactGroupId | string; readonly name: string; readonly description?: string; }
export interface UpdateContactGroupInput { readonly name?: string; readonly description?: string | null; }

export type ContactView = 'ALL' | 'FAVORITES' | 'GROUP' | 'TRASH' | 'ORGANIZATIONS' | 'PEOPLE';
export interface ContactQuery {
  readonly query?: string;
  readonly view?: ContactView;
  readonly groupId?: ContactGroupId | string;
  readonly kind?: ContactKind;
  readonly favorite?: boolean;
  readonly includePrivateNotes?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ContactPage { readonly items: readonly ContactRecord[]; readonly total: number; readonly nextCursor?: string; }
export interface ContactChange {
  readonly kind: 'CONTACT_UPSERT' | 'CONTACT_REMOVE' | 'GROUP_UPSERT' | 'GROUP_REMOVE' | 'SYNC' | 'CONFLICT' | 'IMPORT';
  readonly contactId?: ContactId;
  readonly groupId?: ContactGroupId;
  readonly origin: 'LOCAL' | 'REMOTE' | 'SYSTEM';
}

export interface ContactLookupResult {
  readonly status: 'NONE' | 'MATCH' | 'AMBIGUOUS';
  readonly contacts: readonly ContactRecord[];
}

export interface ContactDuplicateCandidate {
  readonly id: string;
  readonly left: ContactId;
  readonly right: ContactId;
  readonly reasons: readonly ('EXACT_EMAIL' | 'EXACT_PHONE' | 'SAME_IDENTITY' | 'SAME_SOURCE_UID' | 'MATCHING_NAME_OR_ORGANIZATION' | 'SAME_NAME')[];
  readonly strength: 'STRONG' | 'MEDIUM' | 'WEAK';
}

export interface ContactMergeConflict {
  readonly field: 'displayName' | 'organization' | 'notes' | 'avatar' | 'profile' | 'favorite';
  readonly primary: unknown;
  readonly secondary: unknown;
}

export interface ContactMergePreview {
  readonly primary: ContactRecord;
  readonly secondary: ContactRecord;
  readonly merged: ContactRecord;
  readonly conflicts: readonly ContactMergeConflict[];
  readonly survivingId: ContactId;
  readonly redirectedId: ContactId;
}

export interface ContactMergeOptions {
  readonly ownerConfirmed?: boolean;
  readonly notes?: 'PRIMARY' | 'SECONDARY' | 'COMBINE' | 'EMPTY';
  readonly displayName?: 'PRIMARY' | 'SECONDARY';
}

export interface ContactIdentityVerification {
  readonly identityId: NodeId;
  readonly publicKey: string;
  readonly verified: true;
  readonly profile?: ContactProfileInput;
}

export interface ContactIdentityAuthority {
  resolve(identityId: NodeId): Promise<ContactIdentityVerification | undefined> | ContactIdentityVerification | undefined;
  verifyProof?(proof: ContactIdentityProof): Promise<boolean> | boolean;
}

export interface ContactStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemoryContactStateStore implements ContactStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  corrupt(value: unknown): void { this.value = structuredClone(value); }
}
export class PersistentContactStateStore implements ContactStateStore {
  constructor(private readonly backend: ContactStateStore) {}
  read(): Promise<unknown | undefined> { return this.backend.read(); }
  write(value: unknown): Promise<void> { return this.backend.write(value); }
}

export interface ContactSigner {
  sign(payload: string, actor?: NodeId): Promise<string> | string;
  verify?(payload: string, signature: string, actor: NodeId): Promise<boolean> | boolean;
}

export type ContactReplicationOperation = 'contact.upsert' | 'contact.delete' | 'contact.restore' | 'contact.merge' | 'group.upsert' | 'group.delete' | 'device.revoke';
export interface ContactReplicationEvent {
  readonly version: 1;
  readonly protocol: typeof CONTACTS_PROTOCOL;
  readonly id: string;
  readonly ownerIdentityId: NodeId;
  readonly actorDeviceId: string;
  readonly operation: ContactReplicationOperation;
  readonly targetId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly payload: unknown;
  readonly signature?: string;
}
export interface ContactReplicationAdapter { publish(event: ContactReplicationEvent, recipients?: readonly NodeId[]): Promise<void> | void; }

export interface ContactIdentityLinkAction { readonly contactId: ContactId; readonly identityId: NodeId; readonly verified: boolean; }

export interface ContactServiceOptions {
  /** `identityId` is accepted as an additive alias for existing service options. */
  readonly ownerIdentityId?: NodeId;
  readonly identityId?: NodeId;
  readonly deviceId?: string;
  readonly store?: ContactStateStore;
  readonly now?: () => number;
  readonly maxContacts?: number;
  readonly maxGroups?: number;
  readonly signer?: ContactSigner;
  readonly identityAuthority?: ContactIdentityAuthority;
  readonly replication?: ContactReplicationAdapter;
  readonly ownerDeviceRecipients?: readonly NodeId[];
}

type ProvenancedContactInput = {
  readonly [CONTACT_INPUT_PROVENANCE]?: ContactFieldProvenance;
};

export type ContactErrorCode =
  | 'INVALID_ARGUMENT' | 'INVALID_STATE' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'ALREADY_EXISTS'
  | 'AMBIGUOUS' | 'CONFLICT' | 'REPLAY' | 'STALE' | 'BOUNDS_EXCEEDED' | 'UNSAFE_URL'
  | 'INVALID_IDENTITY' | 'INVALID_IMPORT' | 'CONFIRMATION_REQUIRED' | 'SOURCE_UNAVAILABLE';
export class ContactError extends Error {
  constructor(readonly code: ContactErrorCode, message: string) { super(message); this.name = 'ContactError'; }
}

interface ContactVersion {
  readonly clock: number;
  readonly deviceId: string;
  readonly eventId: string;
  readonly deleted?: boolean;
}

interface PersistedContactState {
  readonly version: 1;
  readonly protocol: typeof CONTACTS_PROTOCOL;
  readonly ownerIdentityId: NodeId;
  readonly contacts: readonly ContactRecord[];
  readonly groups: readonly ContactGroup[];
  readonly redirects: readonly { readonly from: ContactId; readonly to: ContactId }[];
  readonly fieldVersions: readonly { readonly contactId: ContactId; readonly fields: Readonly<Record<string, ContactVersion>> }[];
  readonly seenEvents: readonly string[];
  readonly revokedDevices: readonly string[];
  readonly logicalClock: number;
}

export interface ContactServiceDiagnostics {
  readonly contacts: number;
  readonly activeContacts: number;
  readonly trashedContacts: number;
  readonly groups: number;
  readonly indexedTokens: number;
  readonly indexedEmails: number;
  readonly indexedPhones: number;
  readonly indexedIdentities: number;
  readonly redirects: number;
  readonly listeners: number;
  readonly revokedDevices: number;
}

export class ContactService {
  private readonly ownerIdentityId: NodeId;
  private readonly deviceId: string;
  private readonly store: ContactStateStore;
  private readonly now: () => number;
  private readonly maxContacts: number;
  private readonly maxGroups: number;
  private readonly signer?: ContactSigner;
  private readonly identityAuthority?: ContactIdentityAuthority;
  private readonly replication?: ContactReplicationAdapter;
  private readonly ownerDeviceRecipients: readonly NodeId[];
  private readonly contacts = new Map<ContactId, ContactRecord>();
  private readonly groups = new Map<ContactGroupId, ContactGroup>();
  private readonly redirects = new Map<ContactId, ContactId>();
  private readonly fieldVersions = new Map<ContactId, Map<string, ContactVersion>>();
  private readonly seenEvents = new Set<string>();
  private readonly revokedDevices = new Set<string>();
  private readonly searchIndex = new Map<string, Set<ContactId>>();
  private readonly emailIndex = new Map<string, Set<ContactId>>();
  private readonly phoneIndex = new Map<string, Set<ContactId>>();
  private readonly identityIndex = new Map<NodeId, Set<ContactId>>();
  private readonly listeners = new Set<(change: ContactChange) => void>();
  private logicalClock = 0;
  private writes: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private closed = false;

  constructor(options: ContactServiceOptions) {
    const owner = options.ownerIdentityId ?? options.identityId;
    if (!safeId(owner, 512)) throw new ContactError('INVALID_ARGUMENT', 'ContactService requires an owner identity');
    this.ownerIdentityId = owner;
    this.deviceId = safeText(options.deviceId ?? 'local-device', 128) || 'local-device';
    this.store = options.store ?? new InMemoryContactStateStore();
    this.now = options.now ?? Date.now;
    this.maxContacts = boundedInt(options.maxContacts, 1, CONTACTS_MAX_CONTACTS, CONTACTS_MAX_CONTACTS);
    this.maxGroups = boundedInt(options.maxGroups, 1, CONTACTS_MAX_GROUPS, CONTACTS_MAX_GROUPS);
    this.signer = options.signer;
    this.identityAuthority = options.identityAuthority;
    this.replication = options.replication;
    this.ownerDeviceRecipients = [...new Set((options.ownerDeviceRecipients ?? []).filter(value => safeId(value, 512) && value !== owner))].slice(0, 32);
    this.readyPromise = this.hydrate();
  }

  get localOwnerIdentityId(): NodeId { return this.ownerIdentityId; }
  get localDeviceId(): string { return this.deviceId; }
  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.closed = true; this.listeners.clear(); }
  subscribe(listener: (change: ContactChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  diagnostics(): ContactServiceDiagnostics {
    return {
      contacts: this.contacts.size,
      activeContacts: [...this.contacts.values()].filter(value => !value.tombstone).length,
      trashedContacts: [...this.contacts.values()].filter(value => value.tombstone).length,
      groups: this.groups.size,
      indexedTokens: this.searchIndex.size,
      indexedEmails: this.emailIndex.size,
      indexedPhones: this.phoneIndex.size,
      indexedIdentities: this.identityIndex.size,
      redirects: this.redirects.size,
      listeners: this.listeners.size,
      revokedDevices: this.revokedDevices.size,
    };
  }

  async listContacts(options: ContactQuery = {}): Promise<ContactPage> {
    await this.ready();
    const includeTrash = options.view === 'TRASH';
    const values = [...this.contacts.values()]
      .filter(value => includeTrash ? value.tombstone : !value.tombstone)
      .filter(value => !options.kind || value.kind === options.kind)
      .filter(value => options.favorite === undefined || value.favorite === options.favorite)
      .filter(value => options.view !== 'FAVORITES' || value.favorite)
      .filter(value => options.view !== 'ORGANIZATIONS' || value.kind === 'ORGANIZATION')
      .filter(value => options.view !== 'PEOPLE' || value.kind === 'PERSON')
      .filter(value => !options.groupId || value.groupIds.includes(asGroupId(options.groupId)))
      .sort(compareContacts);
    return paginate(values, options);
  }

  async searchContacts(query: string, options: Omit<ContactQuery, 'query'> = {}): Promise<ContactPage> {
    await this.ready();
    const tokens = tokenize(query);
    if (!tokens.length) return this.listContacts(options);
    const candidateIds = new Set<ContactId>();
    for (const token of tokens) for (const id of this.searchIndex.get(token) ?? []) candidateIds.add(id);
    const includePrivateNotes = options.includePrivateNotes !== false;
    const values = [...candidateIds]
      .map(id => this.contacts.get(id))
      .filter((value): value is ContactRecord => Boolean(value && !value.tombstone))
      .filter(value => !options.kind || value.kind === options.kind)
      .filter(value => options.favorite === undefined || value.favorite === options.favorite)
      .filter(value => !options.groupId || value.groupIds.includes(asGroupId(options.groupId)))
      .filter(value => tokens.every(token => searchableText(value, this.groups, includePrivateNotes).includes(token)))
      .sort(compareContacts);
    return paginate(values, options);
  }

  /** Global-search projection intentionally excludes private note snippets. */
  async search(query: string, options: Omit<ContactQuery, 'query'> = {}): Promise<ContactPage> { return this.searchContacts(query, { ...options, includePrivateNotes: false }); }

  getContact(idValue: ContactId | string, options: { readonly includeTrash?: boolean } = {}): ContactRecord {
    const id = this.resolveContactId(idValue);
    const value = this.contacts.get(id);
    if (!value || value.tombstone && !options.includeTrash) throw new ContactError('NOT_FOUND', 'Contact was not found');
    return clone(value!);
  }

  resolveContactId(idValue: ContactId | string): ContactId {
    let id = asContactId(idValue);
    const seen = new Set<ContactId>();
    for (let index = 0; index < 8; index += 1) {
      if (seen.has(id)) throw new ContactError('INVALID_STATE', 'Contact merge redirect cycle detected');
      seen.add(id);
      const next = this.redirects.get(id);
      if (!next) return id;
      id = next;
    }
    throw new ContactError('INVALID_STATE', 'Contact merge redirect chain exceeds its bound');
  }

  async createContact(input: CreateContactInput): Promise<ContactRecord> {
    await this.ready(); this.assertOpen();
    if (this.contacts.size >= this.maxContacts) throw new ContactError('BOUNDS_EXCEEDED', 'Contact bound exceeded');
    const id = asContactId(input.id ?? randomId('contact'));
    if (this.contacts.has(id)) throw new ContactError('ALREADY_EXISTS', 'Contact already exists');
    const now = iso(this.now());
    const record = this.normalizeCreate(input, id, now);
    this.assertGroupsExist(record.groupIds);
    this.assertGroupCapacity(id, record.groupIds);
    const eventId = randomId('contact-event');
    const clock = ++this.logicalClock;
    this.contacts.set(id, record);
    this.initializeVersions(record, eventId, clock);
    this.indexContact(record);
    await this.commitAndPublish(record, 'contact.upsert', eventId, 'LOCAL');
    for (const groupId of record.groupIds) {
      const group = this.groups.get(groupId);
      if (!group || group.tombstone || group.contactIds.includes(id)) continue;
      const updatedGroup: ContactGroup = { ...group, contactIds: [...group.contactIds, id].slice(0, CONTACTS_MAX_GROUP_MEMBERS), updatedAt: now, revision: group.revision + 1 };
      this.groups.set(groupId, updatedGroup);
      await this.commitGroupAndPublish(updatedGroup, 'group.upsert');
      this.emit({ kind: 'GROUP_UPSERT', groupId, origin: 'LOCAL' });
    }
    this.emit({ kind: 'CONTACT_UPSERT', contactId: id, origin: 'LOCAL' });
    return clone(record);
  }

  async updateContact(idValue: ContactId | string, patch: UpdateContactInput): Promise<ContactRecord> {
    await this.ready(); this.assertOpen();
    const id = this.resolveContactId(idValue);
    const current = this.requireActive(id);
    const now = iso(this.now());
    const next = this.normalizeUpdate(current, patch, now);
    this.assertGroupsExist(next.groupIds);
    this.assertGroupCapacity(id, next.groupIds);
    const eventId = randomId('contact-event');
    const clock = ++this.logicalClock;
    this.deindexContact(current);
    this.contacts.set(id, next);
    this.updateVersions(current, next, eventId, clock);
    this.indexContact(next);
    await this.commitAndPublish(next, 'contact.upsert', eventId, 'LOCAL');
    await this.syncGroupMembership(id, current.groupIds, next.groupIds, now);
    this.emit({ kind: 'CONTACT_UPSERT', contactId: id, origin: 'LOCAL' });
    return clone(next);
  }

  async setFavorite(idValue: ContactId | string, favorite: boolean): Promise<ContactRecord> { return this.updateContact(idValue, { favorite }); }
  async setAvatar(idValue: ContactId | string, avatar: ContactAvatarInput | null): Promise<ContactRecord> { return this.updateContact(idValue, { avatar }); }
  async selectPhotoAvatar(idValue: ContactId | string, input: { readonly contentId: string; readonly uri?: string }): Promise<ContactRecord> { return this.updateContact(idValue, { avatar: { source: 'PHOTO_LIBRARY', contentId: input.contentId, uri: input.uri ?? `keystone://content/${input.contentId}` } }); }

  async deleteContact(idValue: ContactId | string): Promise<ContactRecord> {
    await this.ready(); this.assertOpen();
    const id = this.resolveContactId(idValue);
    const current = this.requireActive(id);
    const eventId = randomId('contact-event');
    const clock = ++this.logicalClock;
    const deleted: ContactRecord = { ...current, tombstone: true, deletedAt: iso(this.now()), updatedAt: iso(this.now()), revision: current.revision + 1 };
    this.deindexContact(current); this.contacts.set(id, deleted);
    this.updateVersions(current, deleted, eventId, clock, true);
    await this.commitAndPublish(deleted, 'contact.delete', eventId, 'LOCAL');
    this.emit({ kind: 'CONTACT_REMOVE', contactId: id, origin: 'LOCAL' });
    return clone(deleted);
  }

  async restoreContact(idValue: ContactId | string): Promise<ContactRecord> {
    await this.ready(); this.assertOpen();
    const id = asContactId(idValue);
    const current = this.contacts.get(id);
    if (!current) throw new ContactError('NOT_FOUND', 'Contact was not found');
    if (current.mergedInto) throw new ContactError('CONFLICT', 'A merged Contact cannot be restored independently');
    if (!current.tombstone) return clone(current);
    const eventId = randomId('contact-event'); const clock = ++this.logicalClock; const now = iso(this.now());
    const restored: ContactRecord = { ...current, tombstone: false, deletedAt: undefined, updatedAt: now, revision: current.revision + 1 };
    this.contacts.set(id, restored); this.updateVersions(current, restored, eventId, clock); this.indexContact(restored);
    await this.commitAndPublish(restored, 'contact.restore', eventId, 'LOCAL');
    this.emit({ kind: 'CONTACT_UPSERT', contactId: id, origin: 'LOCAL' });
    return clone(restored);
  }

  async permanentlyDeleteContact(idValue: ContactId | string, ownerConfirmed = false): Promise<void> {
    await this.ready(); this.assertOpen();
    if (!ownerConfirmed) throw new ContactError('CONFIRMATION_REQUIRED', 'Permanent Contact deletion requires explicit owner confirmation');
    const id = asContactId(idValue); const current = this.contacts.get(id);
    if (!current) return;
    if (current.mergedInto) this.redirects.delete(id);
    this.deindexContact(current); this.contacts.delete(id); this.fieldVersions.delete(id);
    for (const [from, to] of this.redirects) if (from === id || to === id) this.redirects.delete(from);
    for (const group of this.groups.values()) if (group.contactIds.includes(id)) { const updatedGroup: ContactGroup = { ...group, contactIds: group.contactIds.filter(value => value !== id), updatedAt: iso(this.now()), revision: group.revision + 1 }; this.groups.set(group.id, updatedGroup); await this.commitGroupAndPublish(updatedGroup, 'group.upsert'); this.emit({ kind: 'GROUP_UPSERT', groupId: group.id, origin: 'LOCAL' }); }
    await this.persist(); this.emit({ kind: 'CONTACT_REMOVE', contactId: id, origin: 'LOCAL' });
  }

  async createGroup(input: CreateContactGroupInput): Promise<ContactGroup> {
    await this.ready(); this.assertOpen();
    if (this.groups.size >= this.maxGroups) throw new ContactError('BOUNDS_EXCEEDED', 'Contact group bound exceeded');
    const id = asGroupId(input.id ?? randomId('contact-group')); if (this.groups.has(id)) throw new ContactError('ALREADY_EXISTS', 'Contact group already exists');
    const now = iso(this.now()); const group: ContactGroup = { version: 1, protocol: CONTACTS_PROTOCOL, id, ownerIdentityId: this.ownerIdentityId, name: boundedRequired(input.name, 240, 'Group name'), ...(input.description ? { description: boundedText(input.description, 2_000) } : {}), contactIds: [], createdAt: now, updatedAt: now, revision: 1, tombstone: false };
    this.groups.set(id, group); await this.commitGroupAndPublish(group, 'group.upsert'); this.emit({ kind: 'GROUP_UPSERT', groupId: id, origin: 'LOCAL' }); return clone(group);
  }

  async updateGroup(idValue: ContactGroupId | string, patch: UpdateContactGroupInput): Promise<ContactGroup> {
    await this.ready(); this.assertOpen(); const id = asGroupId(idValue); const current = this.requireGroup(id);
    const group: ContactGroup = { ...current, name: patch.name === undefined ? current.name : boundedRequired(patch.name, 240, 'Group name'), ...(patch.description === null ? { description: undefined } : patch.description === undefined ? {} : { description: boundedText(patch.description, 2_000) }), updatedAt: iso(this.now()), revision: current.revision + 1 };
    this.groups.set(id, group); this.rebuildIndexes(); await this.commitGroupAndPublish(group, 'group.upsert'); this.emit({ kind: 'GROUP_UPSERT', groupId: id, origin: 'LOCAL' }); return clone(group);
  }

  async listGroups(options: { readonly includeTrash?: boolean } = {}): Promise<readonly ContactGroup[]> { await this.ready(); return [...this.groups.values()].filter(value => options.includeTrash || !value.tombstone).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(clone); }
  getGroup(idValue: ContactGroupId | string, options: { readonly includeTrash?: boolean } = {}): ContactGroup { const value = this.groups.get(asGroupId(idValue)); if (!value || value.tombstone && !options.includeTrash) throw new ContactError('NOT_FOUND', 'Contact group was not found'); return clone(value!); }

  async deleteGroup(idValue: ContactGroupId | string): Promise<ContactGroup> {
    await this.ready(); this.assertOpen(); const id = asGroupId(idValue); const current = this.requireGroup(id); const now = iso(this.now());
    const group: ContactGroup = { ...current, contactIds: [], tombstone: true, updatedAt: now, revision: current.revision + 1 };
    this.groups.set(id, group);
    for (const contactId of current.contactIds) { const contact = this.contacts.get(contactId); if (contact && !contact.tombstone) await this.updateContact(contactId, { groupIds: contact.groupIds.filter(value => value !== id) }); }
    await this.commitGroupAndPublish(group, 'group.delete'); this.emit({ kind: 'GROUP_REMOVE', groupId: id, origin: 'LOCAL' }); return clone(group);
  }

  async addToGroup(groupIdValue: ContactGroupId | string, contactIdValue: ContactId | string): Promise<ContactGroup> {
    await this.ready(); this.assertOpen(); const groupId = asGroupId(groupIdValue); const group = this.requireGroup(groupId); const contactId = this.resolveContactId(contactIdValue); const contact = this.requireActive(contactId);
    this.assertGroupCapacity(contactId, [groupId]);
    let next = group;
    if (!group.contactIds.includes(contactId)) { next = { ...group, contactIds: [...group.contactIds, contactId].slice(0, CONTACTS_MAX_GROUP_MEMBERS), updatedAt: iso(this.now()), revision: group.revision + 1 }; this.groups.set(groupId, next); }
    if (!contact.groupIds.includes(groupId)) await this.updateContact(contactId, { groupIds: [...new Set([...contact.groupIds, groupId])] });
    if (next !== group) { await this.commitGroupAndPublish(next, 'group.upsert'); this.emit({ kind: 'GROUP_UPSERT', groupId, origin: 'LOCAL' }); }
    return clone(this.groups.get(groupId) ?? next);
  }

  async removeFromGroup(groupIdValue: ContactGroupId | string, contactIdValue: ContactId | string): Promise<ContactGroup> {
    await this.ready(); this.assertOpen(); const groupId = asGroupId(groupIdValue); const group = this.requireGroup(groupId); const contactId = this.resolveContactId(contactIdValue); const contact = this.requireActive(contactId);
    const next: ContactGroup = { ...group, contactIds: group.contactIds.filter(value => value !== contactId), updatedAt: iso(this.now()), revision: group.revision + 1 }; this.groups.set(groupId, next); await this.updateContact(contactId, { groupIds: contact.groupIds.filter(value => value !== groupId) }); await this.commitGroupAndPublish(next, 'group.upsert'); this.emit({ kind: 'GROUP_UPSERT', groupId, origin: 'LOCAL' }); return clone(next);
  }

  async linkIdentity(idValue: ContactId | string, input: ContactIdentityLinkInput | NodeId): Promise<ContactIdentityLinkAction> {
    await this.ready(); this.assertOpen(); const id = this.resolveContactId(idValue); const contact = this.requireActive(id); const requested: ContactIdentityLinkInput = typeof input === 'string' ? { identityId: input } : input;
    if (!safeId(requested.identityId, 512)) throw new ContactError('INVALID_IDENTITY', 'Identity reference is invalid');
    let verified = false; let proof = requested.proof;
    if (this.identityAuthority) { const result = await this.identityAuthority.resolve(requested.identityId); if (!result || result.identityId !== requested.identityId || !result.verified) throw new ContactError('INVALID_IDENTITY', 'Identity is not a verified canonical Keystone Identity'); verified = true; proof = { version: 1, identityId: result.identityId, publicKey: result.publicKey, source: 'CANONICAL_IDENTITY', ...(requested.proof?.signature ? { signature: requested.proof.signature } : {}) }; }
    if (proof && proof.identityId !== requested.identityId) throw new ContactError('INVALID_IDENTITY', 'Identity proof binding is invalid');
    const links = contact.identityLinks.filter(value => value.identityId !== requested.identityId);
    const now = iso(this.now()); const link: ContactIdentityLink = { version: 1, id: asFieldId(randomId('contact-identity')), identityId: requested.identityId, state: 'LINKED', provenance: requested.provenance ?? (verified ? 'VERIFIED_EXCHANGE' : 'OWNER_CONFIRMED'), verified, ...(proof ? { proof } : {}), linkedAt: now, linkedBy: this.ownerIdentityId, updatedAt: now };
    const next = contact; const eventId = randomId('contact-event'); const clock = ++this.logicalClock; const updated: ContactRecord = { ...next, identityLinks: [...links, link].slice(0, CONTACTS_MAX_EXTERNAL_HANDLES), updatedAt: now, revision: next.revision + 1 };
    this.deindexContact(next); this.contacts.set(id, updated); this.updateVersions(next, updated, eventId, clock); this.indexContact(updated); await this.commitAndPublish(updated, 'contact.upsert', eventId, 'LOCAL'); this.emit({ kind: 'CONTACT_UPSERT', contactId: id, origin: 'LOCAL' }); return { contactId: id, identityId: requested.identityId, verified };
  }

  async unlinkIdentity(idValue: ContactId | string, identityId: NodeId): Promise<ContactIdentityLinkAction> {
    await this.ready(); this.assertOpen(); const id = this.resolveContactId(idValue); const contact = this.requireActive(id); const existing = contact.identityLinks.find(value => value.identityId === identityId && value.state === 'LINKED'); if (!existing) throw new ContactError('NOT_FOUND', 'Linked Identity was not found');
    const now = iso(this.now()); const links = contact.identityLinks.map(value => value.identityId === identityId ? { ...value, state: 'UNLINKED' as const, verified: false, updatedAt: now } : value); const eventId = randomId('contact-event'); const clock = ++this.logicalClock; const updated: ContactRecord = { ...contact, identityLinks: links, updatedAt: now, revision: contact.revision + 1 }; this.deindexContact(contact); this.contacts.set(id, updated); this.updateVersions(contact, updated, eventId, clock); this.indexContact(updated); await this.commitAndPublish(updated, 'contact.upsert', eventId, 'LOCAL'); this.emit({ kind: 'CONTACT_UPSERT', contactId: id, origin: 'LOCAL' }); return { contactId: id, identityId, verified: false };
  }

  async applyProfileUpdate(idValue: ContactId | string, profile: ContactProfileInput): Promise<ContactRecord> {
    await this.ready(); this.assertOpen(); const id = this.resolveContactId(idValue); const contact = this.requireActive(id); if (!contact.identityLinks.some(value => value.identityId === profile.identityId && value.state === 'LINKED')) throw new ContactError('NOT_AUTHORIZED', 'Profile is not linked to this Contact');
    const safeProfile: ContactProfileRef = { version: 1, identityId: profile.identityId, ...(profile.displayName ? { displayName: boundedText(profile.displayName, 240) } : {}), ...(profile.bio ? { bio: boundedText(profile.bio, 4_000) } : {}), ...(profile.avatarUri ? { avatarUri: safeAvatarUri(profile.avatarUri) } : {}), ...(profile.publicLinks ? { publicLinks: normalizeWebsites(profile.publicLinks, 'PROFILE') } : {}), revision: boundedInt(profile.revision, 1, Number.MAX_SAFE_INTEGER, 1), updatedAt: validIso(profile.updatedAt) ?? iso(this.now()) };
    const current = contact; const nextName = current.displayNameOverride ? current.displayName : safeProfile.displayName ?? current.displayName; const eventId = randomId('contact-event'); const clock = ++this.logicalClock; const updated: ContactRecord = { ...current, profile: safeProfile, displayName: nextName, updatedAt: iso(this.now()), revision: current.revision + 1 }; this.deindexContact(current); this.contacts.set(id, updated); this.updateVersions(current, updated, eventId, clock); this.indexContact(updated); await this.commitAndPublish(updated, 'contact.upsert', eventId, 'LOCAL'); this.emit({ kind: 'CONTACT_UPSERT', contactId: id, origin: 'SYSTEM' }); return clone(updated);
  }

  lookupByEmail(value: string): ContactLookupResult { const key = normalizeEmail(value); return this.lookup(this.emailIndex.get(key)); }
  lookupByPhone(value: string, region?: string): ContactLookupResult { const key = normalizePhone(value, region); return this.lookup(this.phoneIndex.get(key)); }
  lookupByIdentity(identityId: NodeId): ContactLookupResult { return this.lookup(this.identityIndex.get(identityId)); }
  resolveMailSender(address: MailAddress): ContactLookupResult { return this.lookupByEmail(address.address); }
  resolveMessageSender(identityId: NodeId): ContactLookupResult { return this.lookupByIdentity(identityId); }
  resolveCallIdentity(identityId: NodeId): ContactLookupResult { return this.lookupByIdentity(identityId); }
  resolveInboxPerson(contactId: ContactId | string): { readonly contactId: ContactId; readonly emailAddresses: readonly string[]; readonly phoneNumbers: readonly string[]; readonly identityIds: readonly NodeId[] } { const contact = this.getContact(contactId); return { contactId: contact.id, emailAddresses: contact.emails.map(value => value.normalized), phoneNumbers: contact.phones.map(value => value.normalized), identityIds: contact.identityLinks.filter(value => value.state === 'LINKED').map(value => value.identityId) }; }
  async searchMailRecipients(query: string, limit = 50): Promise<readonly MailAddress[]> { const page = await this.searchContacts(query, { limit: boundedInt(limit, 1, 256, 50) }); return uniqueMailAddresses(page.items.flatMap(contact => contact.emails.map(email => ({ name: contact.displayName, address: email.value })))); }
  mailAdapter(): MailContactsAdapter { return createContactMailAdapter(this); }

  detectDuplicateCandidates(options: { readonly limit?: number } = {}): readonly ContactDuplicateCandidate[] {
    const candidates = new Map<string, ContactDuplicateCandidate>(); const limit = boundedInt(options.limit, 1, CONTACTS_MAX_DUPLICATE_CANDIDATES, CONTACTS_MAX_DUPLICATE_CANDIDATES);
    const add = (left: ContactId, right: ContactId, reason: ContactDuplicateCandidate['reasons'][number], strength: ContactDuplicateCandidate['strength']) => { const [a, b] = [left, right].sort(); if (a === b) return; const id = `${a}:${b}`; const existing = candidates.get(id); if (existing) { const reasons = [...new Set([...existing.reasons, reason])]; candidates.set(id, { ...existing, reasons, strength: strongest(existing.strength, strength) }); } else if (candidates.size < limit) candidates.set(id, { id: `duplicate:${a}:${b}`, left: a as ContactId, right: b as ContactId, reasons: [reason], strength }); };
    const fromIndex = (index: ReadonlyMap<string, Set<ContactId>>, reason: ContactDuplicateCandidate['reasons'][number], strength: ContactDuplicateCandidate['strength']) => { for (const ids of index.values()) { const active = [...ids].filter(id => !this.contacts.get(id)?.tombstone).slice(0, 256); for (let i = 0; i < active.length; i += 1) for (let j = i + 1; j < active.length; j += 1) add(active[i]!, active[j]!, reason, strength); if (candidates.size >= limit) return; } };
    fromIndex(this.emailIndex, 'EXACT_EMAIL', 'STRONG'); fromIndex(this.phoneIndex, 'EXACT_PHONE', 'STRONG'); fromIndex(this.identityIndex, 'SAME_IDENTITY', 'STRONG');
    const uid = new Map<string, Set<ContactId>>(); for (const contact of this.activeContacts()) for (const value of contact.sourceUids) { const set = uid.get(value) ?? new Set<ContactId>(); set.add(contact.id); uid.set(value, set); } fromIndex(uid, 'SAME_SOURCE_UID', 'STRONG');
    const names = new Map<string, ContactId[]>(); for (const contact of this.activeContacts()) { const key = normalizeComparable(`${contact.displayName} ${contact.organization?.name ?? ''}`); if (!key) continue; const values = names.get(key) ?? []; values.push(contact.id); names.set(key, values); }
    for (const values of names.values()) { const bounded = values.slice(0, 256); for (let i = 0; i < bounded.length; i += 1) for (let j = i + 1; j < bounded.length; j += 1) add(bounded[i]!, bounded[j]!, 'MATCHING_NAME_OR_ORGANIZATION', 'MEDIUM'); }
    const weakNames = new Map<string, ContactId[]>(); for (const contact of this.activeContacts()) { const key = normalizeComparable(contact.displayName); if (!key) continue; const values = weakNames.get(key) ?? []; values.push(contact.id); weakNames.set(key, values); }
    for (const values of weakNames.values()) { const bounded = values.slice(0, 256); for (let i = 0; i < bounded.length; i += 1) for (let j = i + 1; j < bounded.length; j += 1) add(bounded[i]!, bounded[j]!, 'SAME_NAME', 'WEAK'); }
    return [...candidates.values()].sort((a, b) => strengthRank(b.strength) - strengthRank(a.strength) || a.id.localeCompare(b.id)).slice(0, limit).map(clone);
  }

  previewMerge(primaryIdValue: ContactId | string, secondaryIdValue: ContactId | string, options: Pick<ContactMergeOptions, 'notes' | 'displayName'> = {}): ContactMergePreview {
    const primaryId = this.resolveContactId(primaryIdValue); const secondaryId = this.resolveContactId(secondaryIdValue); if (primaryId === secondaryId) throw new ContactError('CONFLICT', 'Cannot merge a Contact with itself'); const primary = this.requireActive(primaryId); const secondary = this.requireActive(secondaryId); return buildMergePreview(primary, secondary, options);
  }

  async mergeContacts(primaryIdValue: ContactId | string, secondaryIdValue: ContactId | string, options: ContactMergeOptions = {}): Promise<ContactRecord> {
    await this.ready(); this.assertOpen(); if (options.ownerConfirmed !== true) throw new ContactError('CONFIRMATION_REQUIRED', 'Merging Contacts requires explicit owner confirmation'); const preview = this.previewMerge(primaryIdValue, secondaryIdValue, options); const now = iso(this.now()); const eventId = randomId('contact-merge'); const clock = ++this.logicalClock; const merged: ContactRecord = { ...preview.merged, updatedAt: now, revision: Math.max(preview.primary.revision, preview.secondary.revision) + 1, tombstone: false, deletedAt: undefined, mergedInto: undefined }; const absorbed: ContactRecord = { ...preview.secondary, tombstone: true, mergedInto: preview.primary.id, deletedAt: now, updatedAt: now, revision: preview.secondary.revision + 1 };
    this.assertMergeGroupCapacity(preview.primary.id, preview.secondary.id, merged.groupIds);
    this.deindexContact(preview.primary); this.deindexContact(preview.secondary); this.contacts.set(preview.primary.id, merged); this.contacts.set(preview.secondary.id, absorbed); this.redirects.set(preview.secondary.id, preview.primary.id); this.updateVersions(preview.primary, merged, eventId, clock); this.updateVersions(preview.secondary, absorbed, eventId, clock, true); this.indexContact(merged);
    await this.syncMergeGroupMembership(preview.primary.id, preview.secondary.id, merged.groupIds, now); await this.commitAndPublish(merged, 'contact.merge', eventId, 'LOCAL', { absorbed }); await this.persist(); this.emit({ kind: 'CONTACT_UPSERT', contactId: merged.id, origin: 'LOCAL' }); this.emit({ kind: 'CONTACT_REMOVE', contactId: absorbed.id, origin: 'LOCAL' }); return clone(merged);
  }

  async previewVCard(input: string | Uint8Array): Promise<ContactImportPreview> { await this.ready(); return createVCardPreview(input, this); }
  async importVCard(input: string | Uint8Array, options: ContactImportOptions = {}): Promise<ContactImportSummary> { await this.ready(); if (options.ownerConfirmed !== true && options.confirmed !== true) throw new ContactError('CONFIRMATION_REQUIRED', 'vCard import requires preview and explicit owner confirmation'); const preview = createVCardPreview(input, this); return this.importCandidates(preview.items, 'IMPORTED_VCARD'); }
  async previewCsv(input: string | Uint8Array, mapping?: ContactCsvMapping): Promise<ContactCsvImportPreview> { await this.ready(); return createCsvPreview(input, mapping, this); }
  async importCsv(input: string | Uint8Array, options: ContactCsvImportOptions = {}): Promise<ContactImportSummary> { await this.ready(); if (options.ownerConfirmed !== true && options.confirmed !== true) throw new ContactError('CONFIRMATION_REQUIRED', 'CSV import requires preview and explicit owner confirmation'); const preview = createCsvPreview(input, options.mapping, this); return this.importCandidates(preview.items, 'IMPORTED_CSV'); }

  async exportVCard(idValue: ContactId | string, options: ContactExportOptions = {}): Promise<string> { await this.ready(); return VCardCodec.serialize(this.getContact(idValue), options); }
  async exportVCardMany(ids?: readonly (ContactId | string)[], options: ContactExportOptions = {}): Promise<string> { await this.ready(); const values = ids ? ids.map(id => this.getContact(id)) : this.activeContacts(); return VCardCodec.serializeMany(values, options); }
  async exportCsv(ids?: readonly (ContactId | string)[], options: { readonly includePrivateNotes?: boolean } = {}): Promise<string> { await this.ready(); const values = ids ? ids.map(id => this.getContact(id)) : this.activeContacts(); return serializeCsv(values, options); }

  async createContactCard(idValue: ContactId | string, options: ContactCardOptions = {}): Promise<ContactShareCard> { await this.ready(); const contact = this.getContact(idValue); return createContactCard(contact, options); }
  async sendContactCardViaMessage(idValue: ContactId | string, cardValue: ContactShareCard, adapter: ContactMessageCardAdapter): Promise<unknown> { await this.ready(); const recipient = resolveKeystoneMessageRecipient(this, idValue); const card = validateContactCard(cardValue); return adapter.send({ recipientIdentityId: recipient.identityId, card }); }
  receiveContactCard(card: unknown): ContactCardPreview { return previewContactCard(card); }
  async addReceivedContactCard(card: unknown, options: AddReceivedContactCardOptions): Promise<ContactRecord> { await this.ready(); this.assertOpen(); if (options.ownerConfirmed !== true) throw new ContactError('CONFIRMATION_REQUIRED', 'Adding a received Contact card requires explicit owner confirmation'); const valid = validateContactCard(card); const input = withProvenance(contactCardToCreateInput(valid, options.includePrivateNotes === true), 'NEARBY_CARD'); if (options.mode === 'EXISTING') { if (!options.existingContactId) throw new ContactError('INVALID_ARGUMENT', 'An existing Contact is required'); return this.updateContact(options.existingContactId, inputToUpdate(input)); } return this.createContact(input); }

  async handleReplicationEvent(event: ContactReplicationEvent): Promise<boolean> { return this.applyReplicationEvent(event); }
  async applyReplicationEvent(event: ContactReplicationEvent): Promise<boolean> {
    await this.ready(); this.assertOpen(); validateReplicationEvent(event); if (event.ownerIdentityId !== this.ownerIdentityId) throw new ContactError('NOT_AUTHORIZED', 'Replication event belongs to another owner'); if (this.seenEvents.has(event.id)) throw new ContactError('REPLAY', 'Contact replication event was already received'); if (this.revokedDevices.has(event.actorDeviceId)) throw new ContactError('NOT_AUTHORIZED', 'Replication device is revoked');
    if (this.signer?.verify) { if (!event.signature || !(await this.signer.verify(canonicalWithoutSignature(event), event.signature, event.ownerIdentityId))) throw new ContactError('NOT_AUTHORIZED', 'Contact replication signature was rejected'); }
    if (this.ownerDeviceRecipients.length && event.actorDeviceId !== this.deviceId && !this.ownerDeviceRecipients.includes(event.actorDeviceId)) throw new ContactError('NOT_AUTHORIZED', 'Replication actor is not a configured owner device');
    let applied = false;
    if (event.operation === 'device.revoke') { const target = safeText((event.payload as { deviceId?: unknown })?.deviceId, 128); if (!target) throw new ContactError('INVALID_ARGUMENT', 'Revoked device is invalid'); this.revokedDevices.add(target); applied = true; }
    else if (event.operation === 'group.upsert' || event.operation === 'group.delete') { const group = normalizePersistedGroup((event.payload as { group?: unknown })?.group ?? event.payload, this.ownerIdentityId); const current = this.groups.get(group.id); if (!current || group.revision > current.revision || group.revision === current.revision && canonicalJson(group) > canonicalJson(current)) { this.groups.set(group.id, group); this.reindexGroupMembers(group); applied = true; } }
    else if (event.operation === 'contact.merge') { applied = this.applyRemoteMerge(event); }
    else { const payload = event.payload as { record?: unknown; fieldVersions?: unknown }; const incoming = normalizePersistedContact(payload?.record ?? event.payload, this.ownerIdentityId); applied = this.applyRemoteContact(event, incoming, normalizeFieldVersions(payload?.fieldVersions)); }
    this.seenEvents.add(event.id); while (this.seenEvents.size > CONTACTS_MAX_EVENTS) this.seenEvents.delete(this.seenEvents.values().next().value as string); this.logicalClock = Math.max(this.logicalClock, event.revision); if (applied) { await this.persist(); this.emit({ kind: 'SYNC', contactId: safeId(event.targetId, 512) ? asContactId(event.targetId) : undefined, origin: 'REMOTE' }); } return applied;
  }

  async revokeDevice(deviceId: string, ownerConfirmed = false): Promise<void> { await this.ready(); this.assertOpen(); if (!ownerConfirmed) throw new ContactError('CONFIRMATION_REQUIRED', 'Device revocation requires explicit owner confirmation'); const target = safeText(deviceId, 128); if (!target) throw new ContactError('INVALID_ARGUMENT', 'Device id is invalid'); this.revokedDevices.add(target); const event = await this.makeEvent('device.revoke', target, ++this.logicalClock, { deviceId: target }); await this.publishEvent(event); await this.persist(); }

  async projectBirthdays(adapter: ContactBirthdayCalendarAdapter, enabled = true): Promise<readonly ContactBirthdayProjection[]> { await this.ready(); const values = enabled ? this.birthdayProjections() : []; await adapter.replace(CONTACT_BIRTHDAY_SOURCE_ID, values); return values; }
  birthdayProjections(): readonly ContactBirthdayProjection[] { const year = new Date(this.now()).getUTCFullYear(); const values: ContactBirthdayProjection[] = []; for (const contact of this.activeContacts()) for (const date of contact.dates) if (date.kind === 'BIRTHDAY') values.push({ id: `contact-birthday:${contact.id}:${date.id}`, contactId: contact.id, title: `${contact.displayName} · Birthday`, month: date.month, day: date.day, ...(date.year === undefined ? {} : { year: date.year }), yearless: date.year === undefined, sourceId: CONTACT_BIRTHDAY_SOURCE_ID, allDay: true, ...(date.year === undefined ? { projectionYear: year } : {}) }); return values.map(clone); }

  async showAddressOnMap(idValue: ContactId | string, addressId: ContactFieldId | string, adapter: ContactMapsAdapter): Promise<void> { await this.ready(); const contact = this.getContact(idValue); const address = contact.addresses.find(value => value.id === addressId); if (!address) throw new ContactError('NOT_FOUND', 'Contact address was not found'); await adapter.showAddress({ contact, address }); }
  async openWebsite(idValue: ContactId | string, websiteId: ContactFieldId | string, gateway: ContactExternalLinkGateway): Promise<void> { await this.ready(); const contact = this.getContact(idValue); const website = contact.websites.find(value => value.id === websiteId); if (!website) throw new ContactError('NOT_FOUND', 'Contact website was not found'); await gateway.open(website.url); }
  async handoff(idValue: ContactId | string, adapter: ContactContinuityAdapter): Promise<void> { await adapter.openContact({ contact: this.getContact(idValue) }); }

  private async importCandidates(items: readonly ContactImportCandidate[], provenance: Extract<ContactFieldProvenance, 'IMPORTED_VCARD' | 'IMPORTED_CSV'>): Promise<ContactImportSummary> { const imported: ContactId[] = []; let duplicates = 0; let invalid = 0; for (const item of items) { if (!item.input) { invalid += 1; continue; } if (item.duplicateCandidates.length) duplicates += item.duplicateCandidates.length; const input = withProvenance(item.input, provenance); try { const record = await this.createContact(input); imported.push(record.id); } catch { invalid += 1; } } this.emit({ kind: 'IMPORT', origin: 'LOCAL' }); return { imported: imported.length, importedIds: imported, duplicateCandidates: duplicates, invalidEntries: invalid, warnings: [] }; }

  private normalizeCreate(input: CreateContactInput, id: ContactId, now: string): ContactRecord { const name = normalizeName(input.name, input.displayName); const profile = input.profile ? normalizeProfile(input.profile) : undefined; const displayName = boundedRequired(input.displayNameOverride ?? input.displayName ?? name.displayName ?? profile?.displayName ?? fallbackDisplayName(name, input.emails?.[0]?.value), 240, 'Contact name'); const dates = normalizeDates([...(input.dates ?? []), ...(input.birthday ? [typeof input.birthday === 'string' ? parseDateInput(input.birthday) : input.birthday] : [])], 'OWNER_ENTERED'); return { version: 1, protocol: CONTACTS_PROTOCOL, id, ownerIdentityId: this.ownerIdentityId, kind: input.kind ?? 'PERSON', name, displayName, ...(input.displayNameOverride ? { displayNameOverride: boundedText(input.displayNameOverride, 240) } : {}), emails: normalizeEmails(input.emails, 'OWNER_ENTERED'), phones: normalizePhones(input.phones, 'OWNER_ENTERED'), addresses: normalizeAddresses(input.addresses, 'OWNER_ENTERED'), websites: normalizeWebsites(input.websites, 'OWNER_ENTERED'), ...(input.organization ? { organization: normalizeOrganization(input.organization) } : {}), dates, ...(input.notes ? { notes: boundedText(input.notes, CONTACTS_MAX_TEXT_BYTES) } : {}), tags: normalizeTags(input.tags), groupIds: normalizeGroupIds(input.groupIds), favorite: input.favorite === true, ...(input.avatar ? { avatar: normalizeAvatar(input.avatar) } : {}), ...(profile ? { profile } : {}), identityLinks: normalizeIdentityLinks(input.identityLinks, this.ownerIdentityId, now), externalHandles: normalizeExternalHandles(input.externalHandles, 'OWNER_ENTERED'), sourceUids: normalizeStringList(input.sourceUids, 128, 256), createdAt: now, updatedAt: now, revision: 1, tombstone: false };
  }

  private normalizeUpdate(current: ContactRecord, patch: UpdateContactInput, now: string): ContactRecord { const name = patch.name === undefined ? current.name : normalizeName(patch.name, patch.displayName ?? current.displayName); const override = patch.displayNameOverride === null ? undefined : patch.displayNameOverride === undefined ? current.displayNameOverride : boundedText(patch.displayNameOverride, 240); const displayName = override ?? (patch.displayName === undefined ? current.displayName : boundedRequired(patch.displayName, 240, 'Contact name')); const birthday = patch.birthday === null ? [] : patch.birthday === undefined ? [] : [typeof patch.birthday === 'string' ? parseDateInput(patch.birthday) : patch.birthday]; const dates = patch.dates === undefined && patch.birthday === undefined ? current.dates : normalizeDates([...(patch.dates ?? []), ...birthday], 'OWNER_ENTERED', current.dates); return { ...current, kind: patch.kind ?? current.kind, name, displayName, ...(override ? { displayNameOverride: override } : { displayNameOverride: undefined }), emails: patch.emails === undefined ? current.emails : normalizeEmails(patch.emails, 'OWNER_ENTERED', current.emails), phones: patch.phones === undefined ? current.phones : normalizePhones(patch.phones, 'OWNER_ENTERED', current.phones), addresses: patch.addresses === undefined ? current.addresses : normalizeAddresses(patch.addresses, 'OWNER_ENTERED', current.addresses), websites: patch.websites === undefined ? current.websites : normalizeWebsites(patch.websites, 'OWNER_ENTERED', current.websites), ...(patch.organization === null ? { organization: undefined } : patch.organization === undefined ? { organization: current.organization } : { organization: normalizeOrganization(patch.organization) }), dates, ...(patch.notes === null ? { notes: undefined } : patch.notes === undefined ? { notes: current.notes } : { notes: boundedText(patch.notes, CONTACTS_MAX_TEXT_BYTES) }), tags: patch.tags === undefined ? current.tags : normalizeTags(patch.tags), groupIds: patch.groupIds === undefined ? current.groupIds : normalizeGroupIds(patch.groupIds), favorite: patch.favorite ?? current.favorite, ...(patch.avatar === null ? { avatar: undefined } : patch.avatar === undefined ? { avatar: current.avatar } : { avatar: normalizeAvatar(patch.avatar) }), externalHandles: patch.externalHandles === undefined ? current.externalHandles : normalizeExternalHandles(patch.externalHandles, 'OWNER_ENTERED', current.externalHandles), updatedAt: now, revision: current.revision + 1 };
  }

  private async syncGroupMembership(contactId: ContactId, before: readonly ContactGroupId[], after: readonly ContactGroupId[], now: string): Promise<void> {
    const oldIds = new Set(before);
    const nextIds = new Set(after);
    for (const groupId of new Set([...oldIds, ...nextIds])) {
      const group = this.groups.get(groupId);
      if (!group) continue;
      const shouldInclude = nextIds.has(groupId) && !group.tombstone;
      const hasContact = group.contactIds.includes(contactId);
      if (shouldInclude === hasContact) continue;
      const updatedGroup: ContactGroup = { ...group, contactIds: shouldInclude ? [...group.contactIds, contactId].slice(0, CONTACTS_MAX_GROUP_MEMBERS) : group.contactIds.filter(value => value !== contactId), updatedAt: now, revision: group.revision + 1 };
      this.groups.set(groupId, updatedGroup);
      await this.commitGroupAndPublish(updatedGroup, 'group.upsert');
      this.emit({ kind: 'GROUP_UPSERT', groupId, origin: 'LOCAL' });
    }
  }

  private assertGroupCapacity(contactId: ContactId, groupIds: readonly ContactGroupId[]): void {
    for (const groupId of groupIds) {
      const group = this.groups.get(groupId);
      if (group && !group.contactIds.includes(contactId) && group.contactIds.length >= CONTACTS_MAX_GROUP_MEMBERS) throw new ContactError('BOUNDS_EXCEEDED', 'Contact group member bound exceeded');
    }
  }

  private assertMergeGroupCapacity(primaryId: ContactId, secondaryId: ContactId, groupIds: readonly ContactGroupId[]): void {
    for (const groupId of groupIds) {
      const group = this.groups.get(groupId);
      if (group && !group.contactIds.includes(primaryId) && !group.contactIds.includes(secondaryId) && group.contactIds.length >= CONTACTS_MAX_GROUP_MEMBERS) throw new ContactError('BOUNDS_EXCEEDED', 'Contact group member bound exceeded');
    }
  }

  private async syncMergeGroupMembership(primaryId: ContactId, secondaryId: ContactId, groupIds: readonly ContactGroupId[], now: string): Promise<void> {
    const selected = new Set(groupIds);
    for (const group of this.groups.values()) {
      if (!selected.has(group.id) && !group.contactIds.includes(primaryId) && !group.contactIds.includes(secondaryId)) continue;
      const contactIds = group.contactIds.filter(value => value !== primaryId && value !== secondaryId);
      if (selected.has(group.id) && !group.tombstone) contactIds.push(primaryId);
      if (canonicalJson(contactIds) === canonicalJson(group.contactIds)) continue;
      const updatedGroup: ContactGroup = { ...group, contactIds: contactIds.slice(0, CONTACTS_MAX_GROUP_MEMBERS), updatedAt: now, revision: group.revision + 1 };
      this.groups.set(group.id, updatedGroup);
      await this.commitGroupAndPublish(updatedGroup, 'group.upsert');
      this.emit({ kind: 'GROUP_UPSERT', groupId: group.id, origin: 'LOCAL' });
    }
  }

  private assertGroupsExist(groupIds: readonly ContactGroupId[]): void { for (const groupId of groupIds) { const group = this.groups.get(groupId); if (!group || group.tombstone) throw new ContactError('NOT_FOUND', 'Contact group was not found'); } }
  private requireActive(id: ContactId): ContactRecord { const value = this.contacts.get(id); if (!value || value.tombstone) throw new ContactError('NOT_FOUND', 'Contact was not found'); return value; }
  private requireGroup(id: ContactGroupId): ContactGroup { const value = this.groups.get(id); if (!value || value.tombstone) throw new ContactError('NOT_FOUND', 'Contact group was not found'); return value; }
  private activeContacts(): readonly ContactRecord[] { return [...this.contacts.values()].filter(value => !value.tombstone); }
  private lookup(ids: ReadonlySet<ContactId> | undefined): ContactLookupResult { const contacts = [...(ids ?? [])].map(id => this.contacts.get(id)).filter((value): value is ContactRecord => Boolean(value && !value.tombstone)).sort(compareContacts).map(clone); return { status: contacts.length === 0 ? 'NONE' : contacts.length === 1 ? 'MATCH' : 'AMBIGUOUS', contacts }; }
  private assertOpen(): void { if (this.closed) throw new ContactError('INVALID_STATE', 'ContactService is closed'); }

  private indexContact(value: ContactRecord): void { if (value.tombstone) return; const add = (index: Map<string, Set<ContactId>>, key: string) => { if (!key) return; const set = index.get(key) ?? new Set<ContactId>(); set.add(value.id); index.set(key, set); }; for (const token of tokenize(searchableText(value, this.groups, true))) add(this.searchIndex, token); for (const email of value.emails) add(this.emailIndex, email.normalized); for (const phone of value.phones) add(this.phoneIndex, phone.normalized); for (const link of value.identityLinks) if (link.state === 'LINKED') add(this.identityIndex, link.identityId); for (const groupId of value.groupIds) { const group = this.groups.get(groupId); for (const token of tokenize(group?.name ?? '')) add(this.searchIndex, token); } }
  private deindexContact(value: ContactRecord): void { const remove = (index: Map<string, Set<ContactId>>, key: string) => { const set = index.get(key); if (!set) return; set.delete(value.id); if (!set.size) index.delete(key); }; for (const token of tokenize(searchableText(value, this.groups, true))) remove(this.searchIndex, token); for (const email of value.emails) remove(this.emailIndex, email.normalized); for (const phone of value.phones) remove(this.phoneIndex, phone.normalized); for (const link of value.identityLinks) if (link.state === 'LINKED') remove(this.identityIndex, link.identityId); for (const groupId of value.groupIds) for (const token of tokenize(this.groups.get(groupId)?.name ?? '')) remove(this.searchIndex, token); }
  private reindexGroupMembers(group: ContactGroup): void { for (const id of group.contactIds) { const contact = this.contacts.get(id); if (contact && !contact.tombstone) { this.deindexContact(contact); this.indexContact(contact); } } }
  private rebuildIndexes(): void { this.searchIndex.clear(); this.emailIndex.clear(); this.phoneIndex.clear(); this.identityIndex.clear(); for (const value of this.activeContacts()) this.indexContact(value); }

  private initializeVersions(record: ContactRecord, eventId: string, clock: number): void { const map = new Map<string, ContactVersion>(); for (const field of scalarFields(record)) map.set(field, { clock, deviceId: this.deviceId, eventId }); for (const [field, values] of multiValueFields(record)) { for (const value of values) map.set(`${field}:${value.id}`, { clock, deviceId: this.deviceId, eventId }); map.set(`${field}:__order`, { clock, deviceId: this.deviceId, eventId }); } map.set('__record', { clock, deviceId: this.deviceId, eventId, ...(record.tombstone ? { deleted: true } : {}) }); this.fieldVersions.set(record.id, map); }
  private updateVersions(previous: ContactRecord, next: ContactRecord, eventId: string, clock: number, deleted = false): void { const map = this.fieldVersions.get(next.id) ?? new Map<string, ContactVersion>(); const version = (isDeleted = false): ContactVersion => ({ clock, deviceId: this.deviceId, eventId, ...(isDeleted ? { deleted: true } : {}) }); for (const field of scalarFields(next)) if (!sameField(previous, next, field)) map.set(field, version()); for (const [field, values] of multiValueFields(next)) { const oldValues = new Map((multiValueFields(previous).find(([name]) => name === field)?.[1] ?? []).map(value => [value.id, value])); const nextValues = new Map(values.map(value => [value.id, value])); for (const [id, value] of oldValues) if (!nextValues.has(id)) map.set(`${field}:${id}`, version(true)); for (const [id, value] of nextValues) if (!oldValues.has(id) || canonicalJson(oldValues.get(id)) !== canonicalJson(value)) map.set(`${field}:${id}`, version()); if (canonicalJson([...oldValues.keys()]) !== canonicalJson([...nextValues.keys()])) map.set(`${field}:__order`, version()); } map.set('__record', version(deleted)); this.fieldVersions.set(next.id, map); }

  private async commitAndPublish(record: ContactRecord, operation: ContactReplicationOperation, eventId: string, origin: 'LOCAL' | 'REMOTE' | 'SYSTEM', extra: { readonly absorbed?: ContactRecord } = {}): Promise<void> { if (origin !== 'LOCAL') return; const event = await this.makeEvent(operation, record.id, record.revision, { record, fieldVersions: serializeFieldVersions(this.fieldVersions.get(record.id)), ...(extra.absorbed ? { absorbed: extra.absorbed, redirect: { from: extra.absorbed.id, to: record.id } } : {}) }, eventId); await this.publishEvent(event); await this.persist(); }
  private async commitGroupAndPublish(group: ContactGroup, operation: ContactReplicationOperation): Promise<void> { const event = await this.makeEvent(operation, group.id, group.revision, { group }); await this.publishEvent(event); await this.persist(); }
  private async makeEvent(operation: ContactReplicationOperation, targetId: string, revision: number, payload: unknown, forcedId?: string): Promise<ContactReplicationEvent> { const unsigned: Omit<ContactReplicationEvent, 'signature'> = { version: 1, protocol: CONTACTS_PROTOCOL, id: forcedId ?? randomId('contact-event'), ownerIdentityId: this.ownerIdentityId, actorDeviceId: this.deviceId, operation, targetId, revision, createdAt: iso(this.now()), payload: clone(payload) }; return this.signer ? { ...unsigned, signature: await this.signer.sign(canonicalJson(unsigned), this.ownerIdentityId) } : unsigned; }
  private async publishEvent(event: ContactReplicationEvent): Promise<void> { this.seenEvents.add(event.id); while (this.seenEvents.size > CONTACTS_MAX_EVENTS) this.seenEvents.delete(this.seenEvents.values().next().value as string); try { await this.replication?.publish(clone(event), this.ownerDeviceRecipients); } catch { /* Local state remains authoritative while an owned device is offline. */ } }

  private applyRemoteContact(event: ContactReplicationEvent, incoming: ContactRecord, incomingVersions: Map<string, ContactVersion>): boolean {
    const current = this.contacts.get(incoming.id);
    if (!current) { this.contacts.set(incoming.id, incoming); this.fieldVersions.set(incoming.id, incomingVersions.size ? incomingVersions : new Map()); this.indexContact(incoming); return true; }
    const localVersions = this.fieldVersions.get(incoming.id) ?? new Map<string, ContactVersion>();
    const incomingRecordVersion = incomingVersions.get('__record');
    const localRecordVersion = localVersions.get('__record');
    if (incoming.tombstone && incomingRecordVersion && localRecordVersion && compareVersion(incomingRecordVersion, localRecordVersion) <= 0) return false;
    const merged = mergeContactRecords(current, incoming, localVersions, incomingVersions, event.operation === 'contact.delete');
    const restoreWins = event.operation === 'contact.restore' && Boolean(incomingRecordVersion && (!localRecordVersion || compareVersion(incomingRecordVersion, localRecordVersion) > 0));
    const resolved = restoreWins ? { ...merged, tombstone: false, deletedAt: undefined } : merged;
    if (canonicalJson(resolved) === canonicalJson(current)) return false;
    this.deindexContact(current); this.contacts.set(incoming.id, resolved);
    for (const [key, value] of incomingVersions) { const old = localVersions.get(key); if (!old || compareVersion(value, old) > 0) localVersions.set(key, value); }
    this.fieldVersions.set(incoming.id, localVersions); this.indexContact(resolved); return true;
  }
  private applyRemoteMerge(event: ContactReplicationEvent): boolean { const payload = event.payload as { survivor?: unknown; absorbed?: unknown; redirect?: { from?: unknown; to?: unknown }; fieldVersions?: unknown }; if (!payload?.survivor || !payload.absorbed) throw new ContactError('INVALID_STATE', 'Contact merge payload is incomplete'); const survivor = normalizePersistedContact(payload.survivor, this.ownerIdentityId); const absorbed = normalizePersistedContact(payload.absorbed, this.ownerIdentityId); const to = asContactId(safeId(payload.redirect?.to, 512) ? payload.redirect.to : survivor.id); const from = asContactId(safeId(payload.redirect?.from, 512) ? payload.redirect.from : absorbed.id); if (to !== survivor.id || from !== absorbed.id || from === to) throw new ContactError('CONFLICT', 'Contact merge redirect is invalid'); if (this.wouldRedirectCycle(from, to)) throw new ContactError('CONFLICT', 'Contact merge redirect cycle detected'); const existing = this.contacts.get(to); if (!existing || survivor.revision >= existing.revision) { if (existing) this.deindexContact(existing); this.contacts.set(to, survivor); this.indexContact(survivor); } const oldAbsorbed = this.contacts.get(from); if (oldAbsorbed) this.deindexContact(oldAbsorbed); this.contacts.set(from, absorbed); this.redirects.set(from, to); return true; }
  private wouldRedirectCycle(from: ContactId, to: ContactId): boolean { let current: ContactId | undefined = to; for (let i = 0; i < 8 && current; i += 1) { if (current === from) return true; current = this.redirects.get(current); } return Boolean(current); }

  private async hydrate(): Promise<void> { const raw = await this.store.read(); if (raw === undefined) return; const snapshot = parseSnapshot(raw, this.ownerIdentityId); this.contacts.clear(); this.groups.clear(); this.redirects.clear(); this.fieldVersions.clear(); this.seenEvents.clear(); this.revokedDevices.clear(); for (const value of snapshot.contacts) this.contacts.set(value.id, value); for (const value of snapshot.groups) this.groups.set(value.id, value); for (const value of snapshot.redirects) this.redirects.set(value.from, value.to); for (const value of snapshot.fieldVersions) this.fieldVersions.set(value.contactId, new Map(Object.entries(value.fields))); snapshot.seenEvents.forEach(value => this.seenEvents.add(value)); snapshot.revokedDevices.forEach(value => this.revokedDevices.add(value)); this.logicalClock = snapshot.logicalClock; this.rebuildIndexes(); }
  private async persist(): Promise<void> { const snapshot: PersistedContactState = { version: 1, protocol: CONTACTS_PROTOCOL, ownerIdentityId: this.ownerIdentityId, contacts: [...this.contacts.values()].map(clone), groups: [...this.groups.values()].map(clone), redirects: [...this.redirects.entries()].map(([from, to]) => ({ from, to })).slice(0, CONTACTS_MAX_REDIRECTS), fieldVersions: [...this.fieldVersions.entries()].map(([contactId, fields]) => ({ contactId, fields: Object.fromEntries(fields.entries()) })).slice(0, CONTACTS_MAX_CONTACTS), seenEvents: [...this.seenEvents].slice(-CONTACTS_MAX_EVENTS), revokedDevices: [...this.revokedDevices].slice(0, 256), logicalClock: this.logicalClock }; this.writes = this.writes.then(() => this.store.write(snapshot)); await this.writes; }
  private emit(change: ContactChange): void { if (this.closed) return; for (const listener of this.listeners) listener(change); }
}

export const CONTACT_BIRTHDAY_SOURCE_ID = 'contacts:birthdays';
export interface ContactBirthdayProjection { readonly id: string; readonly contactId: ContactId; readonly title: string; readonly month: number; readonly day: number; readonly year?: number; readonly projectionYear?: number; readonly yearless: boolean; readonly sourceId: typeof CONTACT_BIRTHDAY_SOURCE_ID; readonly allDay: true; }
export interface ContactBirthdayCalendarAdapter { replace(sourceId: string, values: readonly ContactBirthdayProjection[]): Promise<void> | void; }
export interface ContactMapsAdapter { showAddress(input: { readonly contact: ContactRecord; readonly address: ContactAddress }): Promise<void> | void; }
export interface ContactExternalLinkGateway { open(url: string): Promise<void> | void; }
export interface ContactContinuityAdapter { openContact(input: { readonly contact: ContactRecord }): Promise<void> | void; }

export interface ContactMailAdapterOptions { readonly includePhone?: boolean; }
export function createContactMailAdapter(service: ContactService, options: ContactMailAdapterOptions = {}): MailContactsAdapter {
  return {
    search: (query, limit) => service.searchMailRecipients(query, limit),
    link: async (address, contactId) => { const targetId = service.resolveContactId(contactId); const result = service.lookupByEmail(address.address); if (result.status === 'AMBIGUOUS') throw new ContactError('AMBIGUOUS', 'Email address belongs to multiple Contacts'); if (result.status === 'MATCH' && result.contacts[0]!.id !== targetId) throw new ContactError('CONFLICT', 'Mail address belongs to another Contact'); if (result.status === 'NONE') { const contact = service.getContact(targetId); await service.updateContact(targetId, { emails: [...contact.emails, { value: address.address, ...(address.name ? { label: address.name } : {}) }] }); } },
  };
}

export interface ContactMessageRecipient { readonly contactId: ContactId; readonly identityId: NodeId; readonly displayName: string; }
export interface ContactMessageCardAdapter { send(input: { readonly recipientIdentityId: NodeId; readonly card: ContactShareCard }): Promise<unknown> | unknown; }
export interface ContactCallRecipient { readonly contactId: ContactId; readonly identityId: NodeId; readonly displayName: string; }
export function resolveKeystoneMessageRecipient(service: ContactService, idValue: ContactId | string): ContactMessageRecipient {
  const contact = service.getContact(idValue); const links = contact.identityLinks.filter(value => value.state === 'LINKED'); if (links.length !== 1) throw new ContactError(links.length ? 'AMBIGUOUS' : 'SOURCE_UNAVAILABLE', 'A Keystone Identity is required for a Keystone message'); return { contactId: contact.id, identityId: links[0]!.identityId, displayName: contact.displayName };
}
export async function sendContactCardViaMessage(service: ContactService, idValue: ContactId | string, cardValue: ContactShareCard, adapter: ContactMessageCardAdapter): Promise<unknown> { return service.sendContactCardViaMessage(idValue, cardValue, adapter); }
export function resolveCallRecipient(service: ContactService, idValue: ContactId | string): ContactCallRecipient { const value = resolveKeystoneMessageRecipient(service, idValue); return value; }

export interface ContactSharedFolderRecipient { readonly contactId: ContactId; readonly identityId: NodeId; readonly displayName: string; }
export function resolveSharedFolderRecipient(service: ContactService, idValue: ContactId | string): ContactSharedFolderRecipient { const value = resolveKeystoneMessageRecipient(service, idValue); return value; }
export function resolveSpaceRecipient(service: ContactService, idValue: ContactId | string): ContactSharedFolderRecipient { return resolveSharedFolderRecipient(service, idValue); }

export interface ContactInboxPersonFilter { readonly contactId: ContactId; readonly exactEmails: readonly string[]; readonly exactPhones: readonly string[]; readonly linkedIdentityIds: readonly NodeId[]; }
export function createContactInboxPersonFilter(service: ContactService, idValue: ContactId | string): ContactInboxPersonFilter { const value = service.resolveInboxPerson(service.resolveContactId(idValue)); return { contactId: value.contactId, exactEmails: value.emailAddresses, exactPhones: value.phoneNumbers, linkedIdentityIds: value.identityIds }; }

export interface ContactTaskReference { readonly version: 1; readonly type: 'contact'; readonly id: ContactId; readonly label: string; readonly dataClass: 'PRIVATE'; }
export function createContactTaskReference(service: ContactService, idValue: ContactId | string): ContactTaskReference { const contact = service.getContact(idValue); return { version: 1, type: 'contact', id: contact.id, label: contact.displayName, dataClass: 'PRIVATE' }; }

export type ContactCardField = 'name' | 'identity' | 'profile' | 'emails' | 'phones' | 'addresses' | 'websites' | 'organization' | 'dates' | 'avatar' | 'privateNotes';
export interface ContactCardIdentity { readonly identityId: NodeId; readonly verified: boolean; readonly proof?: ContactIdentityProof; }
export interface ContactCardData {
  readonly displayName?: string;
  readonly name?: ContactName;
  readonly identities?: readonly ContactCardIdentity[];
  readonly profile?: Pick<ContactProfileRef, 'identityId' | 'displayName' | 'bio' | 'avatarUri' | 'publicLinks'>;
  readonly emails?: readonly Pick<ContactEmail, 'value' | 'label' | 'preferred'>[];
  readonly phones?: readonly Pick<ContactPhone, 'value' | 'label' | 'preferred'>[];
  readonly addresses?: readonly Omit<ContactAddress, 'version' | 'id' | 'provenance'>[];
  readonly websites?: readonly Pick<ContactWebsite, 'url' | 'label'>[];
  readonly organization?: ContactOrganization;
  readonly dates?: readonly Pick<ContactDate, 'kind' | 'label' | 'month' | 'day' | 'year'>[];
  readonly avatar?: ContactAvatar;
  readonly privateNotes?: string;
}
export interface ContactShareCard {
  readonly version: 1;
  readonly protocol: typeof CONTACTS_PROTOCOL;
  readonly kind: 'CONTACT_CARD';
  readonly id: ContactCardId;
  readonly fields: readonly ContactCardField[];
  readonly data: ContactCardData;
  readonly senderIdentityId?: NodeId;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly signature?: string;
}
export interface ContactCardOptions { readonly fields?: readonly ContactCardField[]; readonly includePrivateNotes?: boolean; readonly senderIdentityId?: NodeId; readonly expiresAt?: string; readonly signature?: string; }
export interface ContactCardPreview { readonly valid: true; readonly fields: readonly ContactCardField[]; readonly data: ContactCardData; readonly senderIdentityId?: NodeId; readonly warnings: readonly string[]; }
export interface AddReceivedContactCardOptions { readonly ownerConfirmed: boolean; readonly mode: 'NEW' | 'EXISTING'; readonly existingContactId?: ContactId | string; readonly includePrivateNotes?: boolean; }

const DEFAULT_CARD_FIELDS: readonly ContactCardField[] = ['name', 'identity', 'profile', 'emails', 'phones', 'addresses', 'websites', 'organization', 'dates', 'avatar'];
const CONTACT_CARD_FIELDS = new Set<ContactCardField>(['name', 'identity', 'profile', 'emails', 'phones', 'addresses', 'websites', 'organization', 'dates', 'avatar', 'privateNotes']);
export function createContactCard(contact: ContactRecord, options: ContactCardOptions = {}): ContactShareCard {
  const fields = [...new Set(options.fields ?? DEFAULT_CARD_FIELDS)].filter(value => CONTACT_CARD_FIELDS.has(value)); if (!fields.length || fields.length > CONTACTS_MAX_CARD_FIELDS) throw new ContactError('INVALID_ARGUMENT', 'Contact card field selection is invalid'); const data: ContactCardData = {};
  if (fields.includes('name')) Object.assign(data, { displayName: contact.displayName, name: contact.name });
  if (fields.includes('identity')) Object.assign(data, { identities: contact.identityLinks.filter(value => value.state === 'LINKED' && value.verified).map(value => ({ identityId: value.identityId, verified: true, ...(value.proof ? { proof: value.proof } : {}) })) });
  if (fields.includes('profile') && contact.profile) Object.assign(data, { profile: { identityId: contact.profile.identityId, ...(contact.profile.displayName ? { displayName: contact.profile.displayName } : {}), ...(contact.profile.bio ? { bio: contact.profile.bio } : {}), ...(contact.profile.avatarUri ? { avatarUri: contact.profile.avatarUri } : {}), ...(contact.profile.publicLinks ? { publicLinks: contact.profile.publicLinks } : {}) } });
  if (fields.includes('emails')) Object.assign(data, { emails: contact.emails.map(value => ({ value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })) });
  if (fields.includes('phones')) Object.assign(data, { phones: contact.phones.map(value => ({ value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })) });
  if (fields.includes('addresses')) Object.assign(data, { addresses: contact.addresses.map(value => ({ ...(value.label ? { label: value.label } : {}), ...(value.street ? { street: value.street } : {}), ...(value.locality ? { locality: value.locality } : {}), ...(value.region ? { region: value.region } : {}), ...(value.postalCode ? { postalCode: value.postalCode } : {}), ...(value.country ? { country: value.country } : {}), ...(value.formatted ? { formatted: value.formatted } : {}) })) });
  if (fields.includes('websites')) Object.assign(data, { websites: contact.websites.map(value => ({ url: value.url, ...(value.label ? { label: value.label } : {}) })) });
  if (fields.includes('organization') && contact.organization) Object.assign(data, { organization: contact.organization });
  if (fields.includes('dates')) Object.assign(data, { dates: contact.dates.map(value => ({ kind: value.kind, ...(value.label ? { label: value.label } : {}), month: value.month, day: value.day, ...(value.year === undefined ? {} : { year: value.year }) })) });
  if (fields.includes('avatar') && contact.avatar) Object.assign(data, { avatar: contact.avatar });
  if (fields.includes('privateNotes') && options.includePrivateNotes === true && contact.notes) Object.assign(data, { privateNotes: contact.notes }); else if (fields.includes('privateNotes')) throw new ContactError('NOT_AUTHORIZED', 'Private Contact notes are disabled for Contact cards by default');
  const card: ContactShareCard = { version: 1, protocol: CONTACTS_PROTOCOL, kind: 'CONTACT_CARD', id: asCardId(randomId('contact-card')), fields, data, ...(options.senderIdentityId ? { senderIdentityId: options.senderIdentityId } : {}), createdAt: iso(Date.now()), ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}), ...(options.signature ? { signature: options.signature } : {}) }; if (serializedBytes(card) > CONTACTS_MAX_CARD_BYTES) throw new ContactError('BOUNDS_EXCEEDED', 'Contact card exceeds its size bound'); return card;
}
export function validateContactCard(value: unknown): ContactShareCard { if (!isRecord(value) || value.version !== 1 || value.protocol !== CONTACTS_PROTOCOL || value.kind !== 'CONTACT_CARD' || !safeId(value.id, 256) || !Array.isArray(value.fields) || !isRecord(value.data)) throw new ContactError('INVALID_ARGUMENT', 'Contact card is malformed'); const fields = [...new Set(value.fields.filter(item => typeof item === 'string'))] as ContactCardField[]; if (!fields.length || fields.some(item => !CONTACT_CARD_FIELDS.has(item)) || fields.length > CONTACTS_MAX_CARD_FIELDS) throw new ContactError('INVALID_ARGUMENT', 'Contact card fields are invalid'); const data = normalizeCardData(value.data, fields); const card: ContactShareCard = { version: 1, protocol: CONTACTS_PROTOCOL, kind: 'CONTACT_CARD', id: asCardId(value.id), fields, data, ...(safeId(value.senderIdentityId, 512) ? { senderIdentityId: value.senderIdentityId as NodeId } : {}), createdAt: validIso(value.createdAt) ?? iso(0), ...(validIso(value.expiresAt) ? { expiresAt: value.expiresAt as string } : {}), ...(typeof value.signature === 'string' ? { signature: value.signature.slice(0, 2_048) } : {}) }; if (card.expiresAt && Date.parse(card.expiresAt) <= Date.now()) throw new ContactError('INVALID_ARGUMENT', 'Contact card is expired'); if (serializedBytes(card) > CONTACTS_MAX_CARD_BYTES) throw new ContactError('BOUNDS_EXCEEDED', 'Contact card exceeds its size bound'); return card; }
export function previewContactCard(value: unknown): ContactCardPreview { const card = validateContactCard(value); return { valid: true, fields: card.fields, data: clone(card.data), ...(card.senderIdentityId ? { senderIdentityId: card.senderIdentityId } : {}), warnings: card.data.privateNotes ? ['Private notes are present and require explicit local policy.'] : [] }; }

export interface ContactNearbyExchangePort { send(input: { readonly endpointId: string; readonly card: ContactShareCard }): Promise<unknown>; decode(input: NearbyContactExchangeObject): ContactShareCard; }
export function contactCardToNearbyObject(cardValue: ContactShareCard): NearbyContactExchangeObject { const card = validateContactCard(cardValue); const selectedFields: NearbyContactField[] = []; const fields: Partial<Record<NearbyContactField, string | readonly { readonly label: string; readonly url: string }[]>> = {}; const add = (cardField: ContactCardField, nearbyField: NearbyContactField, value: string | readonly { readonly label: string; readonly url: string }[] | undefined) => { if (value === undefined) return; selectedFields.push(nearbyField); fields[nearbyField] = value; }; if (card.fields.includes('name')) add('name', 'displayName', card.data.displayName); if (card.fields.includes('identity')) add('identity', 'identityId', card.data.identities?.find(value => value.verified)?.identityId); if (card.fields.includes('avatar')) add('avatar', 'avatarUri', card.data.avatar?.uri); if (card.fields.includes('emails')) add('emails', 'collaborationEmail', card.data.emails?.[0]?.value); if (card.fields.includes('phones')) add('phones', 'phoneNumber', card.data.phones?.[0]?.value); if (card.fields.includes('websites')) add('websites', 'publicLinks', card.data.websites?.map(value => ({ label: value.label ?? 'website', url: value.url }))); if (!selectedFields.length) throw new ContactError('INVALID_ARGUMENT', 'Contact card has no Nearby-compatible fields'); return { version: 1, type: 'contact', selectedFields: [...new Set(selectedFields)], fields }; }
export function contactCardFromNearbyObject(value: NearbyContactExchangeObject): ContactShareCard { if (value.type !== 'contact') throw new ContactError('INVALID_ARGUMENT', 'Nearby object is not a Contact card'); const fields: ContactCardField[] = []; const raw = value.fields; const data: ContactCardData = {}; if (value.selectedFields.includes('displayName') && typeof raw.displayName === 'string') { fields.push('name'); Object.assign(data, { displayName: raw.displayName }); } if (value.selectedFields.includes('identityId') && typeof raw.identityId === 'string') { fields.push('identity'); Object.assign(data, { identities: [{ identityId: raw.identityId as NodeId, verified: false }] }); } if (value.selectedFields.includes('avatarUri') && typeof raw.avatarUri === 'string') { fields.push('avatar'); Object.assign(data, { avatar: { version: 1, source: 'PROFILE' as const, uri: safeAvatarUri(raw.avatarUri) } }); } if (value.selectedFields.includes('collaborationEmail') && typeof raw.collaborationEmail === 'string') { fields.push('emails'); Object.assign(data, { emails: [{ value: boundedRequired(raw.collaborationEmail, 320, 'Email'), preferred: true }] }); } if (value.selectedFields.includes('phoneNumber') && typeof raw.phoneNumber === 'string') { fields.push('phones'); Object.assign(data, { phones: [{ value: boundedRequired(raw.phoneNumber, 128, 'Phone'), preferred: true }] }); } if (value.selectedFields.includes('publicLinks') && Array.isArray(raw.publicLinks)) { fields.push('websites'); Object.assign(data, { websites: raw.publicLinks.map(link => ({ url: sanitizeContactWebsite(link.url), label: link.label })) }); } return validateContactCard({ version: 1, protocol: CONTACTS_PROTOCOL, kind: 'CONTACT_CARD', id: randomId('contact-card'), fields: [...new Set(fields)], data, createdAt: iso(Date.now()) }); }
export function createContactNearbyExchangePort(nearby: { createOffer(input: { readonly endpointId: string; readonly object: NearbyContactExchangeObject }): Promise<unknown> }): ContactNearbyExchangePort { return { send: input => nearby.createOffer({ endpointId: input.endpointId, object: contactCardToNearbyObject(input.card) }), decode: contactCardFromNearbyObject }; }

export interface ContactImportOptions { readonly confirmed?: boolean; readonly ownerConfirmed?: boolean; }
export interface ContactImportCandidate { readonly sourceIndex: number; readonly input: CreateContactInput; readonly duplicateCandidates: readonly ContactDuplicateCandidate[]; readonly warnings: readonly string[]; }
export interface ContactImportPreview { readonly id: ContactImportId; readonly format: 'VCARD' | 'CSV'; readonly contactCount: number; readonly duplicateCandidateCount: number; readonly invalidEntries: number; readonly images: number; readonly warnings: readonly string[]; readonly items: readonly ContactImportCandidate[]; }
export interface ContactImportSummary { readonly imported: number; readonly importedIds: readonly ContactId[]; readonly duplicateCandidates: number; readonly invalidEntries: number; readonly warnings: readonly string[]; }
export class ContactImportService { constructor(private readonly contacts: ContactService) {} previewVCard(input: string | Uint8Array): Promise<ContactImportPreview> { return this.contacts.previewVCard(input); } importVCard(input: string | Uint8Array, options: ContactImportOptions = {}): Promise<ContactImportSummary> { return this.contacts.importVCard(input, options); } previewCsv(input: string | Uint8Array, mapping?: ContactCsvMapping): Promise<ContactCsvImportPreview> { return this.contacts.previewCsv(input, mapping); } importCsv(input: string | Uint8Array, options: ContactCsvImportOptions = {}): Promise<ContactImportSummary> { return this.contacts.importCsv(input, options); } }

export interface VCardProperty { readonly name: string; readonly params: Readonly<Record<string, string>>; readonly value: string; readonly binary?: Uint8Array; }
export interface VCardCard { readonly version: '3.0' | '4.0'; readonly properties: readonly VCardProperty[]; readonly sourceIndex: number; readonly warnings: readonly string[]; }
export interface VCardParseOptions { readonly maxBytes?: number; readonly maxCards?: number; }

export class VCardCodec {
  static parse(input: string | Uint8Array, options: VCardParseOptions = {}): readonly VCardCard[] { return parseVCards(input, options); }
  parse(input: string | Uint8Array, options: VCardParseOptions = {}): readonly VCardCard[] { return VCardCodec.parse(input, options); }
  static serialize(contact: ContactRecord, options: ContactExportOptions = {}): string { return serializeVCard(contact, options); }
  serialize(contact: ContactRecord, options: ContactExportOptions = {}): string { return VCardCodec.serialize(contact, options); }
  static serializeMany(contacts: readonly ContactRecord[], options: ContactExportOptions = {}): string { return contacts.map(value => serializeVCard(value, options)).join('\r\n'); }
  serializeMany(contacts: readonly ContactRecord[], options: ContactExportOptions = {}): string { return VCardCodec.serializeMany(contacts, options); }
}
export interface ContactExportOptions { readonly fields?: readonly ContactCardField[]; readonly includePrivateNotes?: boolean; readonly version?: '3.0' | '4.0'; }

export type ContactCsvField = 'displayName' | 'givenName' | 'familyName' | 'nickname' | 'email' | 'phone' | 'address' | 'organization' | 'jobTitle' | 'birthday' | 'notes' | 'tags';
export type ContactCsvMapping = Readonly<Partial<Record<ContactCsvField, number>>>;
export interface ContactCsvImportOptions extends ContactImportOptions { readonly mapping?: ContactCsvMapping; }
export interface ContactCsvImportPreview extends ContactImportPreview { readonly format: 'CSV'; readonly headers: readonly string[]; readonly mapping: ContactCsvMapping; }
export class ContactCsvCodec { static parse(input: string | Uint8Array): readonly (readonly string[])[] { return parseCsv(input); } static serialize(contacts: readonly ContactRecord[], options: { readonly includePrivateNotes?: boolean } = {}): string { return serializeCsv(contacts, options); } }

function createVCardPreview(input: string | Uint8Array, service: ContactService): ContactImportPreview { let cards: readonly VCardCard[]; try { cards = VCardCodec.parse(input); } catch (error) { throw error instanceof ContactError ? error : new ContactError('INVALID_IMPORT', 'vCard input is invalid'); } const items: ContactImportCandidate[] = []; let invalidEntries = 0; let images = 0; const warnings: string[] = []; for (const card of cards) { try { const converted = vCardToInput(card); if (converted.input.avatar) images += 1; items.push({ sourceIndex: card.sourceIndex, input: converted.input, duplicateCandidates: duplicateCandidatesForInput(converted.input, service), warnings: [...card.warnings, ...converted.warnings] }); warnings.push(...card.warnings, ...converted.warnings); } catch (error) { invalidEntries += 1; warnings.push(error instanceof Error ? error.message : 'Invalid vCard entry'); } } const duplicateCandidateCount = items.reduce((sum, value) => sum + value.duplicateCandidates.length, 0); return { id: asImportId(randomId('contact-import')), format: 'VCARD', contactCount: items.length, duplicateCandidateCount, invalidEntries, images, warnings: uniqueStrings(warnings).slice(0, 256), items };
}

function createCsvPreview(input: string | Uint8Array, mapping: ContactCsvMapping | undefined, service: ContactService): ContactCsvImportPreview { const rows = parseCsv(input); const headers = rows[0] ?? []; const resolved = mapping ?? inferCsvMapping(headers); const items: ContactImportCandidate[] = []; let invalidEntries = 0; const warnings: string[] = []; for (let index = 1; index < rows.length; index += 1) { const row = rows[index]!; if (!row.some(value => value.trim())) continue; try { const converted = csvRowToInput(row, resolved); items.push({ sourceIndex: index - 1, input: converted, duplicateCandidates: duplicateCandidatesForInput(converted, service), warnings: [] }); } catch (error) { invalidEntries += 1; warnings.push(error instanceof Error ? error.message : 'Invalid CSV row'); } } const duplicateCandidateCount = items.reduce((sum, value) => sum + value.duplicateCandidates.length, 0); return { id: asImportId(randomId('contact-import')), format: 'CSV', headers, mapping: resolved, contactCount: items.length, duplicateCandidateCount, invalidEntries, images: 0, warnings: uniqueStrings(warnings).slice(0, 256), items };
}

function duplicateCandidatesForInput(input: CreateContactInput, service: ContactService): readonly ContactDuplicateCandidate[] { const found: ContactDuplicateCandidate[] = []; for (const email of input.emails ?? []) { const lookup = service.lookupByEmail(email.value); for (const contact of lookup.contacts) found.push({ id: `duplicate:${contact.id}:import`, left: contact.id, right: 'import:pending' as ContactId, reasons: ['EXACT_EMAIL'], strength: 'STRONG' }); } for (const phone of input.phones ?? []) { const lookup = service.lookupByPhone(phone.value, phone.region); for (const contact of lookup.contacts) found.push({ id: `duplicate:${contact.id}:import`, left: contact.id, right: 'import:pending' as ContactId, reasons: ['EXACT_PHONE'], strength: 'STRONG' }); } return found.slice(0, 64); }

function vCardToInput(card: VCardCard): { readonly input: CreateContactInput; readonly warnings: readonly string[] } { const props = new Map<string, VCardProperty[]>(); for (const prop of card.properties) { const values = props.get(prop.name) ?? []; values.push(prop); props.set(prop.name, values); } const fn = firstProp(props, 'FN')?.value; const n = firstProp(props, 'N')?.value.split(';') ?? []; const name: ContactName = { ...(fn ? { displayName: fn } : {}), ...(n[1] ? { givenName: n[1] } : {}), ...(n[0] ? { familyName: n[0] } : {}), ...(n[2] ? { middleName: n[2] } : {}), ...(n[3] ? { prefix: n[3] } : {}), ...(n[4] ? { suffix: n[4] } : {}), ...(firstProp(props, 'NICKNAME')?.value ? { nickname: firstProp(props, 'NICKNAME')!.value.split(',')[0] } : {}) }; const emails = (props.get('EMAIL') ?? []).map(prop => ({ value: prop.value, label: prop.params.TYPE, preferred: hasPref(prop) })); const phones = (props.get('TEL') ?? []).map(prop => ({ value: prop.value, label: prop.params.TYPE, preferred: hasPref(prop) })); const addresses = (props.get('ADR') ?? []).map(prop => { const parts = prop.value.split(';'); return { label: prop.params.TYPE, poBox: undefined, street: parts[2], locality: parts[3], region: parts[4], postalCode: parts[5], country: parts[6], formatted: parts.filter(Boolean).join(', ') }; }); const websites = (props.get('URL') ?? []).flatMap(prop => { try { return [{ value: sanitizeContactWebsite(prop.value), label: prop.params.TYPE }]; } catch { return []; } }).map(value => ({ url: value.value, label: value.label })); const org = firstProp(props, 'ORG')?.value; const title = firstProp(props, 'TITLE')?.value; const dates = (props.get('BDAY') ?? []).flatMap(prop => { try { return [parseDateInput(prop.value)]; } catch { return []; } }); const categories = (props.get('CATEGORIES') ?? []).flatMap(prop => prop.value.split(',')).filter(Boolean); const photo = firstPhoto(props.get('PHOTO') ?? []); const sourceUids = (props.get('UID') ?? []).map(value => value.value).filter(Boolean); const warnings: string[] = websites.length !== (props.get('URL') ?? []).length ? ['Unsafe website URL was ignored.'] : []; const input: CreateContactInput = { name, displayName: fn ?? name.displayName, emails, phones, addresses, websites, ...(org || title ? { organization: { ...(org ? { name: org.split(';')[0] } : {}), ...(title ? { jobTitle: title } : {}) } } : {}), dates, tags: categories, ...(firstProp(props, 'NOTE')?.value ? { notes: firstProp(props, 'NOTE')!.value } : {}), ...(photo ? { avatar: photo } : {}), sourceUids }; if (!input.displayName && !input.emails?.length && !input.phones?.length && !input.addresses?.length) throw new ContactError('INVALID_IMPORT', 'vCard has no usable Contact fields'); return { input, warnings };
}

function parseVCards(input: string | Uint8Array, options: VCardParseOptions = {}): readonly VCardCard[] { const bytes = input instanceof Uint8Array ? input.byteLength : new TextEncoder().encode(input).byteLength; const maxBytes = boundedInt(options.maxBytes, 1, CONTACTS_MAX_VCARD_BYTES, CONTACTS_MAX_VCARD_BYTES); if (bytes > maxBytes) throw new ContactError('BOUNDS_EXCEEDED', 'vCard file exceeds its byte bound'); let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(input instanceof Uint8Array ? input : new TextEncoder().encode(input)); } catch { throw new ContactError('INVALID_IMPORT', 'vCard is not valid UTF-8'); } const lines = unfoldVCard(text); const cards: VCardCard[] = []; let current: { version: '3.0' | '4.0'; properties: VCardProperty[]; warnings: string[] } | undefined; const maxCards = boundedInt(options.maxCards, 1, CONTACTS_MAX_VCARD_CARDS, CONTACTS_MAX_VCARD_CARDS); for (const line of lines) { if (!line.trim()) continue; if (line.toUpperCase() === 'BEGIN:VCARD') { if (current) throw new ContactError('INVALID_IMPORT', 'Nested vCard card is invalid'); current = { version: '3.0', properties: [], warnings: [] }; continue; } if (line.toUpperCase() === 'END:VCARD') { if (!current) continue; cards.push({ version: current.version, properties: current.properties, sourceIndex: cards.length, warnings: current.warnings }); current = undefined; if (cards.length >= maxCards) break; continue; } if (!current) continue; if (current.properties.length >= CONTACTS_MAX_VCARD_PROPERTIES) { current.warnings.push('Property limit exceeded; remaining properties were ignored.'); continue; } const property = parseVCardProperty(line); if (!property) { current.warnings.push('Malformed vCard property was ignored.'); continue; } if (property.name === 'VERSION') { if (property.value === '4.0') current.version = '4.0'; else if (property.value === '3.0') current.version = '3.0'; else current.warnings.push('Unsupported vCard version; parsed as vCard 3.0.'); continue; } current.properties.push(property); } if (current) throw new ContactError('INVALID_IMPORT', 'vCard has an unterminated card'); return cards; }

function unfoldVCard(input: string): readonly string[] { const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); const raw = normalized.split('\n'); const lines: string[] = []; for (const line of raw) { if (line.startsWith(' ') || line.startsWith('\t')) { if (!lines.length) throw new ContactError('INVALID_IMPORT', 'vCard folding is invalid'); lines[lines.length - 1] += line.slice(1); } else lines.push(line); } for (const line of lines) if (new TextEncoder().encode(line).byteLength > CONTACTS_MAX_VCARD_LINE_BYTES) throw new ContactError('BOUNDS_EXCEEDED', 'vCard line exceeds its byte bound'); return lines; }
function parseVCardProperty(line: string): VCardProperty | undefined { const separator = findUnquoted(line, ':'); if (separator < 1) return undefined; const head = line.slice(0, separator); let value = line.slice(separator + 1); const parts = head.split(';'); const name = parts.shift()!.toUpperCase(); if (!/^[A-Z0-9-]{1,64}$/.test(name)) return undefined; const params: Record<string, string> = {}; for (const part of parts) { const index = part.indexOf('='); if (index < 1) continue; params[part.slice(0, index).toUpperCase()] = part.slice(index + 1).replace(/^"|"$/g, '').slice(0, 256); } const encoding = (params.ENCODING ?? '').toLowerCase(); let binary: Uint8Array | undefined; if (encoding === 'quoted-printable') value = decodeQuotedPrintable(value); if (encoding === 'b' || encoding === 'base64') { binary = decodeBase64Bounded(value, name === 'PHOTO' ? CONTACTS_MAX_VCARD_PHOTO_BYTES : CONTACTS_MAX_VCARD_VALUE_BYTES); value = new TextDecoder().decode(binary); } value = unescapeVCard(value); if (new TextEncoder().encode(value).byteLength > CONTACTS_MAX_VCARD_VALUE_BYTES) throw new ContactError('BOUNDS_EXCEEDED', 'vCard property value exceeds its bound'); return { name, params, value, ...(binary ? { binary } : {}) }; }

function serializeVCard(contact: ContactRecord, options: ContactExportOptions = {}): string { const fields = new Set(options.fields ?? DEFAULT_CARD_FIELDS); const version = options.version ?? '4.0'; const lines = ['BEGIN:VCARD', `VERSION:${version}`]; if (fields.has('name')) { lines.push(`FN:${escapeVCard(contact.displayName)}`); const n = contact.name; lines.push(`N:${[n.familyName, n.givenName, n.middleName, n.prefix, n.suffix].map(value => escapeVCard(value ?? '')).join(';')}`); if (n.nickname) lines.push(`NICKNAME:${escapeVCard(n.nickname)}`); } if (fields.has('identity')) for (const link of contact.identityLinks.filter(value => value.state === 'LINKED' && value.verified)) lines.push(`X-KEYSTONE-IDENTITY:${escapeVCard(link.identityId)}`); if (fields.has('emails')) for (const email of contact.emails) lines.push(`EMAIL${email.label ? `;TYPE=${escapeVCard(email.label)}` : ''}${email.preferred ? ';PREF=1' : ''}:${escapeVCard(email.value)}`); if (fields.has('phones')) for (const phone of contact.phones) lines.push(`TEL${phone.label ? `;TYPE=${escapeVCard(phone.label)}` : ''}${phone.preferred ? ';PREF=1' : ''}:${escapeVCard(phone.value)}`); if (fields.has('addresses')) for (const address of contact.addresses) lines.push(`ADR${address.label ? `;TYPE=${escapeVCard(address.label)}` : ''}:${['', '', address.street, address.locality, address.region, address.postalCode, address.country].map(value => escapeVCard(value ?? '')).join(';')}`); if (fields.has('organization') && contact.organization) { if (contact.organization.name) lines.push(`ORG:${escapeVCard(contact.organization.name)}`); if (contact.organization.jobTitle) lines.push(`TITLE:${escapeVCard(contact.organization.jobTitle)}`); } if (fields.has('dates')) for (const date of contact.dates) { const value = `${date.year === undefined ? '--' : `${date.year.toString().padStart(4, '0')}-`}${date.month.toString().padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`; lines.push(`${date.kind === 'BIRTHDAY' ? 'BDAY' : 'X-KEYSTONE-DATE'}${date.label ? `;TYPE=${escapeVCard(date.label)}` : ''}:${value}`); } if (fields.has('websites')) for (const website of contact.websites) lines.push(`URL${website.label ? `;TYPE=${escapeVCard(website.label)}` : ''}:${escapeVCard(website.url)}`); if (fields.has('privateNotes') && options.includePrivateNotes === true && contact.notes) lines.push(`NOTE:${escapeVCard(contact.notes)}`); if (fields.has('avatar') && contact.avatar?.uri.startsWith('data:image/')) lines.push(`PHOTO:${contact.avatar.uri}`); if (contact.sourceUids[0]) lines.push(`UID:${escapeVCard(contact.sourceUids[0])}`); lines.push('END:VCARD'); return lines.map(foldVCardLine).join('\r\n'); }

function parseCsv(input: string | Uint8Array): readonly (readonly string[])[] { const bytes = input instanceof Uint8Array ? input.byteLength : new TextEncoder().encode(input).byteLength; if (bytes > CONTACTS_MAX_CSV_BYTES) throw new ContactError('BOUNDS_EXCEEDED', 'CSV file exceeds its byte bound'); let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(input instanceof Uint8Array ? input : new TextEncoder().encode(input)); } catch { throw new ContactError('INVALID_IMPORT', 'CSV is not valid UTF-8'); } const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; const pushField = () => { if (new TextEncoder().encode(field).byteLength > CONTACTS_MAX_CSV_FIELD_BYTES) throw new ContactError('BOUNDS_EXCEEDED', 'CSV field exceeds its byte bound'); row.push(field); field = ''; }; const pushRow = () => { pushField(); if (row.length > CONTACTS_MAX_CSV_COLUMNS) throw new ContactError('BOUNDS_EXCEEDED', 'CSV column bound exceeded'); rows.push(row); row = []; if (rows.length > CONTACTS_MAX_CSV_ROWS + 1) throw new ContactError('BOUNDS_EXCEEDED', 'CSV row bound exceeded'); }; for (let i = 0; i < text.length; i += 1) { const char = text[i]!; if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (char === '"') quoted = false; else field += char; } else if (char === '"' && field === '') quoted = true; else if (char === ',') pushField(); else if (char === '\n') pushRow(); else if (char !== '\r') field += char; } if (quoted) throw new ContactError('INVALID_IMPORT', 'CSV has an unterminated quoted field'); if (field || row.length) pushRow(); return rows; }
function serializeCsv(contacts: readonly ContactRecord[], options: { readonly includePrivateNotes?: boolean } = {}): string { const headers = ['displayName', 'givenName', 'familyName', 'nickname', 'email', 'phone', 'address', 'organization', 'jobTitle', 'birthday', 'notes', 'tags']; const rows = [headers, ...contacts.map(contact => [contact.displayName, contact.name.givenName ?? '', contact.name.familyName ?? '', contact.name.nickname ?? '', contact.emails.map(value => value.value).join(';'), contact.phones.map(value => value.value).join(';'), contact.addresses.map(value => value.formatted ?? [value.street, value.locality, value.region, value.postalCode, value.country].filter(Boolean).join(', ')).join(';'), contact.organization?.name ?? '', contact.organization?.jobTitle ?? '', contact.dates.filter(value => value.kind === 'BIRTHDAY').map(value => value.year === undefined ? `--${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}` : `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`).join(';'), options.includePrivateNotes === true ? contact.notes ?? '' : '', contact.tags.join(';')])]; return rows.map(row => row.map(value => csvCell(value)).join(',')).join('\r\n'); }

function csvRowToInput(row: readonly string[], mapping: ContactCsvMapping): CreateContactInput { const get = (key: ContactCsvField): string => { const index = mapping[key]; if (index === undefined) return ''; const value = safeText(row[index] ?? '', CONTACTS_MAX_CSV_FIELD_BYTES); return /^'[=+\-@]/.test(value) ? value.slice(1) : value; }; const split = (value: string): readonly string[] => value.split(/[;|]/).map(item => item.trim()).filter(Boolean); const email = get('email'); const phone = get('phone'); const tags = split(get('tags')); const address = get('address'); const date = get('birthday'); return { displayName: get('displayName') || undefined, name: { ...(get('givenName') ? { givenName: get('givenName') } : {}), ...(get('familyName') ? { familyName: get('familyName') } : {}), ...(get('nickname') ? { nickname: get('nickname') } : {}) }, emails: split(email).map(value => ({ value })), phones: split(phone).map(value => ({ value })), addresses: address ? [{ formatted: address }] : [], organization: get('organization') || get('jobTitle') ? { ...(get('organization') ? { name: get('organization') } : {}), ...(get('jobTitle') ? { jobTitle: get('jobTitle') } : {}) } : undefined, dates: date ? [parseDateInput(date)] : [], notes: get('notes') || undefined, tags };
}

function inferCsvMapping(headers: readonly string[]): ContactCsvMapping { const mapping: ContactCsvMapping = {}; headers.forEach((value, index) => { const key = normalizeComparable(value).replace(/[^a-z0-9]+/g, ''); const found: Partial<Record<string, ContactCsvField>> = { displayname: 'displayName', name: 'displayName', givenname: 'givenName', firstname: 'givenName', familyname: 'familyName', lastname: 'familyName', surname: 'familyName', nickname: 'nickname', email: 'email', emailaddress: 'email', phone: 'phone', phonenumber: 'phone', address: 'address', organization: 'organization', company: 'organization', jobtitle: 'jobTitle', title: 'jobTitle', birthday: 'birthday', bday: 'birthday', notes: 'notes', note: 'notes', tags: 'tags', categories: 'tags' }; const field = found[key]; if (field && mapping[field] === undefined) (mapping as Record<ContactCsvField, number>)[field] = index; }); return mapping; }

function normalizeCardData(value: Record<string, unknown>, fields: readonly ContactCardField[]): ContactCardData { const data: ContactCardData = {}; if (fields.includes('name')) { if (typeof value.displayName !== 'string' && !isRecord(value.name)) throw new ContactError('INVALID_ARGUMENT', 'Contact card name is invalid'); Object.assign(data, { ...(typeof value.displayName === 'string' ? { displayName: boundedText(value.displayName, 240) } : {}), ...(isRecord(value.name) ? { name: normalizeName(value.name as ContactName, typeof value.displayName === 'string' ? value.displayName : undefined) } : {}) }); } if (fields.includes('identity') && value.identities !== undefined) { if (!Array.isArray(value.identities)) throw new ContactError('INVALID_ARGUMENT', 'Contact card Identity data is invalid'); Object.assign(data, { identities: value.identities.slice(0, 16).filter(isRecord).flatMap(item => safeId(item.identityId, 512) ? [{ identityId: item.identityId as NodeId, verified: item.verified === true, ...(isRecord(item.proof) ? { proof: item.proof as ContactIdentityProof } : {}) }] : []) }); } if (fields.includes('emails')) Object.assign(data, { emails: normalizeCardEmails(value.emails) }); if (fields.includes('phones')) Object.assign(data, { phones: normalizeCardPhones(value.phones) }); if (fields.includes('addresses')) Object.assign(data, { addresses: normalizeCardAddresses(value.addresses) }); if (fields.includes('websites')) Object.assign(data, { websites: normalizeCardWebsites(value.websites) }); if (fields.includes('organization') && isRecord(value.organization)) Object.assign(data, { organization: normalizeOrganization(value.organization as ContactOrganization) }); if (fields.includes('dates')) Object.assign(data, { dates: normalizeCardDates(value.dates) }); if (fields.includes('avatar') && isRecord(value.avatar)) Object.assign(data, { avatar: normalizeAvatar(value.avatar as ContactAvatarInput) }); if (fields.includes('privateNotes') && typeof value.privateNotes === 'string') Object.assign(data, { privateNotes: boundedText(value.privateNotes, CONTACTS_MAX_TEXT_BYTES) }); if (fields.includes('profile') && isRecord(value.profile) && safeId(value.profile.identityId, 512)) Object.assign(data, { profile: { identityId: value.profile.identityId as NodeId, ...(typeof value.profile.displayName === 'string' ? { displayName: boundedText(value.profile.displayName, 240) } : {}), ...(typeof value.profile.bio === 'string' ? { bio: boundedText(value.profile.bio, 4_000) } : {}), ...(typeof value.profile.avatarUri === 'string' ? { avatarUri: safeAvatarUri(value.profile.avatarUri) } : {}), ...(Array.isArray(value.profile.publicLinks) ? { publicLinks: normalizeWebsites(value.profile.publicLinks as ContactWebsiteInput[], 'PROFILE') } : {}) } }); return data; }

function contactCardToCreateInput(card: ContactShareCard, includePrivateNotes = false): CreateContactInput { const data = card.data; const identities = data.identities?.filter(value => value.verified).map(value => ({ identityId: value.identityId, provenance: 'VERIFIED_EXCHANGE' as const, ...(value.proof ? { proof: value.proof } : {}) })); return { ...(data.name ? { name: data.name } : {}), ...(data.displayName ? { displayName: data.displayName } : {}), ...(data.emails ? { emails: data.emails.map(value => ({ value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })) } : {}), ...(data.phones ? { phones: data.phones.map(value => ({ value: value.value, ...(value.label ? { label: value.label } : {}), preferred: value.preferred })) } : {}), ...(data.addresses ? { addresses: data.addresses } : {}), ...(data.websites ? { websites: data.websites } : {}), ...(data.organization ? { organization: data.organization } : {}), ...(data.dates ? { dates: data.dates } : {}), ...(data.avatar ? { avatar: data.avatar } : {}), ...(includePrivateNotes && data.privateNotes ? { notes: data.privateNotes } : {}), ...(identities?.length ? { identityLinks: identities } : {}) }; }
function inputToUpdate(input: CreateContactInput): UpdateContactInput { return input; }
function withProvenance(input: CreateContactInput, provenance: ContactFieldProvenance): CreateContactInput & ProvenancedContactInput {
  const mark = <T>(values: readonly T[] | undefined): readonly (T & { readonly provenance: ContactFieldProvenance })[] | undefined => values?.map(value => ({ ...value, provenance }));
  return {
    ...input,
    [CONTACT_INPUT_PROVENANCE]: provenance,
    ...(input.emails ? { emails: mark(input.emails) } : {}),
    ...(input.phones ? { phones: mark(input.phones) } : {}),
    ...(input.addresses ? { addresses: mark(input.addresses) } : {}),
    ...(input.websites ? { websites: mark(input.websites) } : {}),
    ...(input.dates ? { dates: mark(input.dates) } : {}),
    ...(input.externalHandles ? { externalHandles: mark(input.externalHandles) } : {}),
    ...(input.birthday && typeof input.birthday !== 'string' ? { birthday: { ...input.birthday, provenance } } : {}),
  } as CreateContactInput & ProvenancedContactInput;
}

function normalizePersistedContact(value: unknown, ownerIdentityId: NodeId): ContactRecord { if (!isRecord(value) || value.version !== 1 || value.protocol !== CONTACTS_PROTOCOL || value.ownerIdentityId !== ownerIdentityId || !safeId(value.id, 512)) throw new ContactError('INVALID_STATE', 'Persisted Contact is invalid'); const contact = normalizeRecordLike(value as Partial<ContactRecord>, ownerIdentityId); if (contact.id !== value.id) throw new ContactError('INVALID_STATE', 'Persisted Contact id is invalid'); return contact; }
function normalizeRecordLike(value: Partial<ContactRecord>, ownerIdentityId: NodeId): ContactRecord { const id = asContactId(value.id ?? randomId('contact')); const name = normalizeName(value.name, value.displayName); const displayName = boundedRequired(value.displayName ?? name.displayName ?? 'Unnamed contact', 240, 'Contact name'); return { version: 1, protocol: CONTACTS_PROTOCOL, id, ownerIdentityId, kind: value.kind === 'ORGANIZATION' ? 'ORGANIZATION' : 'PERSON', name, displayName, ...(typeof value.displayNameOverride === 'string' ? { displayNameOverride: boundedText(value.displayNameOverride, 240) } : {}), emails: normalizeEmails(value.emails as ContactEmailInput[] | undefined, 'OWNER_ENTERED'), phones: normalizePhones(value.phones as ContactPhoneInput[] | undefined, 'OWNER_ENTERED'), addresses: normalizeAddresses(value.addresses as ContactAddressInput[] | undefined, 'OWNER_ENTERED'), websites: normalizeWebsites(value.websites as ContactWebsiteInput[] | undefined, 'OWNER_ENTERED'), ...(value.organization ? { organization: normalizeOrganization(value.organization) } : {}), dates: normalizeDates(value.dates as ContactDateInput[] | undefined, 'OWNER_ENTERED'), ...(typeof value.notes === 'string' ? { notes: boundedText(value.notes, CONTACTS_MAX_TEXT_BYTES) } : {}), tags: normalizeTags(value.tags), groupIds: normalizeGroupIds(value.groupIds), favorite: value.favorite === true, ...(value.avatar ? { avatar: normalizeAvatar(value.avatar) } : {}), ...(value.profile ? { profile: normalizeProfile(value.profile as ContactProfileInput) } : {}), identityLinks: normalizeIdentityLinks(value.identityLinks as ContactIdentityLinkInput[] | undefined, ownerIdentityId, validIso(value.updatedAt) ?? iso(0), true), externalHandles: normalizeExternalHandles(value.externalHandles as never, 'OWNER_ENTERED'), sourceUids: normalizeStringList(value.sourceUids, 128, 256), createdAt: validIso(value.createdAt) ?? iso(0), updatedAt: validIso(value.updatedAt) ?? iso(0), revision: boundedInt(value.revision, 1, Number.MAX_SAFE_INTEGER, 1), tombstone: value.tombstone === true, ...(validIso(value.deletedAt) ? { deletedAt: value.deletedAt } : {}), ...(safeId(value.mergedInto, 512) ? { mergedInto: asContactId(value.mergedInto) } : {}) }; }
function normalizePersistedGroup(value: unknown, ownerIdentityId: NodeId): ContactGroup { if (!isRecord(value) || value.version !== 1 || value.protocol !== CONTACTS_PROTOCOL || value.ownerIdentityId !== ownerIdentityId || !safeId(value.id, 512)) throw new ContactError('INVALID_STATE', 'Persisted Contact group is invalid'); return { version: 1, protocol: CONTACTS_PROTOCOL, id: asGroupId(value.id), ownerIdentityId, name: boundedRequired(value.name, 240, 'Group name'), ...(typeof value.description === 'string' ? { description: boundedText(value.description, 2_000) } : {}), contactIds: Array.isArray(value.contactIds) ? [...new Set(value.contactIds.filter(item => safeId(item, 512)).map(item => asContactId(item)))].slice(0, CONTACTS_MAX_GROUP_MEMBERS) : [], createdAt: validIso(value.createdAt) ?? iso(0), updatedAt: validIso(value.updatedAt) ?? iso(0), revision: boundedInt(value.revision, 1, Number.MAX_SAFE_INTEGER, 1), tombstone: value.tombstone === true }; }
function parseSnapshot(value: unknown, ownerIdentityId: NodeId): PersistedContactState { if (!isRecord(value) || value.version !== 1 || value.protocol !== CONTACTS_PROTOCOL || value.ownerIdentityId !== ownerIdentityId) throw new ContactError('INVALID_STATE', 'Contact state is invalid or belongs to another owner'); const contacts = Array.isArray(value.contacts) ? value.contacts.slice(0, CONTACTS_MAX_CONTACTS).map(item => { try { return normalizePersistedContact(item, ownerIdentityId); } catch { return undefined; } }).filter((item): item is ContactRecord => Boolean(item)) : []; const groups = Array.isArray(value.groups) ? value.groups.slice(0, CONTACTS_MAX_GROUPS).map(item => { try { return normalizePersistedGroup(item, ownerIdentityId); } catch { return undefined; } }).filter((item): item is ContactGroup => Boolean(item)) : []; const redirects = Array.isArray(value.redirects) ? value.redirects.slice(0, CONTACTS_MAX_REDIRECTS).flatMap(item => isRecord(item) && safeId(item.from, 512) && safeId(item.to, 512) && item.from !== item.to ? [{ from: asContactId(item.from), to: asContactId(item.to) }] : []) : []; const fieldVersions = Array.isArray(value.fieldVersions) ? value.fieldVersions.slice(0, CONTACTS_MAX_CONTACTS).flatMap(item => { if (!isRecord(item) || !safeId(item.contactId, 512) || !isRecord(item.fields)) return []; return [{ contactId: asContactId(item.contactId), fields: normalizeFieldVersionRecord(item.fields) }]; }) : []; return { version: 1, protocol: CONTACTS_PROTOCOL, ownerIdentityId, contacts, groups, redirects, fieldVersions, seenEvents: Array.isArray(value.seenEvents) ? value.seenEvents.filter(item => safeId(item, 512)).slice(-CONTACTS_MAX_EVENTS) : [], revokedDevices: Array.isArray(value.revokedDevices) ? value.revokedDevices.filter(item => safeText(item, 128)).slice(0, 256) : [], logicalClock: boundedInt(value.logicalClock, 0, Number.MAX_SAFE_INTEGER, 0) }; }
function validateReplicationEvent(event: ContactReplicationEvent): void { if (!event || event.version !== 1 || event.protocol !== CONTACTS_PROTOCOL || !safeId(event.id, 512) || !safeId(event.ownerIdentityId, 512) || !safeText(event.actorDeviceId, 128) || !safeText(event.targetId, 512) || !Number.isSafeInteger(event.revision) || event.revision < 1 || !validIso(event.createdAt) || !['contact.upsert', 'contact.delete', 'contact.restore', 'contact.merge', 'group.upsert', 'group.delete', 'device.revoke'].includes(event.operation)) throw new ContactError('INVALID_ARGUMENT', 'Contact replication event is malformed'); }
function canonicalWithoutSignature(value: ContactReplicationEvent): string { const { signature: _signature, ...unsigned } = value; return canonicalJson(unsigned); }
function normalizeFieldVersions(value: unknown): Map<string, ContactVersion> { if (!isRecord(value)) return new Map(); const output = new Map<string, ContactVersion>(); for (const [key, candidate] of Object.entries(value)) if (isRecord(candidate) && Number.isSafeInteger(candidate.clock) && candidate.clock >= 0 && safeText(candidate.deviceId, 128) && safeText(candidate.eventId, 512)) output.set(key, { clock: candidate.clock as number, deviceId: candidate.deviceId as string, eventId: candidate.eventId as string, ...(candidate.deleted === true ? { deleted: true } : {}) }); return output; }
function normalizeFieldVersionRecord(value: Record<string, unknown>): Readonly<Record<string, ContactVersion>> { return Object.fromEntries(normalizeFieldVersions(value)); }
function serializeFieldVersions(value: Map<string, ContactVersion> | undefined): Readonly<Record<string, ContactVersion>> { return Object.fromEntries(value?.entries() ?? []); }
function mergeContactRecords(current: ContactRecord, incoming: ContactRecord, localVersions: Map<string, ContactVersion>, incomingVersions: Map<string, ContactVersion>, incomingDelete: boolean): ContactRecord { const choose = <T>(field: string, left: T, right: T): T => { const incomingVersion = incomingVersions.get(field); const localVersion = localVersions.get(field); return incomingVersion && (!localVersion || compareVersion(incomingVersion, localVersion) > 0) ? right : left; }; const merged: ContactRecord = { ...current, kind: choose('kind', current.kind, incoming.kind), name: choose('name', current.name, incoming.name), displayName: choose('displayName', current.displayName, incoming.displayName), displayNameOverride: choose('displayNameOverride', current.displayNameOverride, incoming.displayNameOverride), organization: choose('organization', current.organization, incoming.organization), notes: choose('notes', current.notes, incoming.notes), tags: choose('tags', current.tags, incoming.tags), groupIds: choose('groupIds', current.groupIds, incoming.groupIds), favorite: choose('favorite', current.favorite, incoming.favorite), avatar: choose('avatar', current.avatar, incoming.avatar), profile: choose('profile', current.profile, incoming.profile), sourceUids: choose('sourceUids', current.sourceUids, incoming.sourceUids), emails: mergeMulti('emails', current.emails, incoming.emails, localVersions, incomingVersions), phones: mergeMulti('phones', current.phones, incoming.phones, localVersions, incomingVersions), addresses: mergeMulti('addresses', current.addresses, incoming.addresses, localVersions, incomingVersions), websites: mergeMulti('websites', current.websites, incoming.websites, localVersions, incomingVersions), dates: mergeMulti('dates', current.dates, incoming.dates, localVersions, incomingVersions), identityLinks: mergeMulti('identityLinks', current.identityLinks, incoming.identityLinks, localVersions, incomingVersions), externalHandles: mergeMulti('externalHandles', current.externalHandles, incoming.externalHandles, localVersions, incomingVersions), updatedAt: Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt) ? incoming.updatedAt : current.updatedAt, revision: Math.max(current.revision, incoming.revision), tombstone: incomingDelete ? true : current.tombstone, ...(incomingDelete ? { deletedAt: incoming.deletedAt ?? incoming.updatedAt } : current.deletedAt ? { deletedAt: current.deletedAt } : {}), ...(current.mergedInto ? { mergedInto: current.mergedInto } : incoming.mergedInto ? { mergedInto: incoming.mergedInto } : {}) }; return merged; }
function mergeMulti<T extends { readonly id: ContactFieldId }>(field: string, left: readonly T[], right: readonly T[], local: Map<string, ContactVersion>, incoming: Map<string, ContactVersion>): readonly T[] { const values = new Map<string, T>(left.map(value => [value.id, value])); const ids = new Set([...left.map(value => value.id), ...right.map(value => value.id)]); for (const id of ids) { const l = values.get(id); const r = right.find(value => value.id === id); const rv = incoming.get(`${field}:${id}`); const lv = local.get(`${field}:${id}`); if (rv && (!lv || compareVersion(rv, lv) > 0)) { if (rv.deleted) values.delete(id); else if (r) values.set(id, r); } else if (!l && r) values.set(id, r); } const preferred = right.map(value => value.id); return [...values.values()].sort((a, b) => { const ai = preferred.indexOf(a.id); const bi = preferred.indexOf(b.id); if (ai >= 0 && bi >= 0) return ai - bi; if (ai >= 0) return -1; if (bi >= 0) return 1; return a.id.localeCompare(b.id); }); }

function buildMergePreview(primary: ContactRecord, secondary: ContactRecord, options: Pick<ContactMergeOptions, 'notes' | 'displayName'>): ContactMergePreview { const conflicts: ContactMergeConflict[] = []; const displayName = options.displayName === 'SECONDARY' ? secondary.displayName : primary.displayName || secondary.displayName; if (primary.displayName && secondary.displayName && primary.displayName !== secondary.displayName) conflicts.push({ field: 'displayName', primary: primary.displayName, secondary: secondary.displayName }); const organization = primary.organization ?? secondary.organization; if (primary.organization && secondary.organization && canonicalJson(primary.organization) !== canonicalJson(secondary.organization)) conflicts.push({ field: 'organization', primary: primary.organization, secondary: secondary.organization }); const notes = options.notes === 'SECONDARY' ? secondary.notes : options.notes === 'COMBINE' ? [primary.notes, secondary.notes].filter(Boolean).join('\n\n') || undefined : options.notes === 'EMPTY' ? undefined : primary.notes ?? secondary.notes; if (primary.notes && secondary.notes && primary.notes !== secondary.notes) conflicts.push({ field: 'notes', primary: primary.notes, secondary: secondary.notes }); if (primary.avatar && secondary.avatar && canonicalJson(primary.avatar) !== canonicalJson(secondary.avatar)) conflicts.push({ field: 'avatar', primary: primary.avatar, secondary: secondary.avatar }); if (primary.profile && secondary.profile && canonicalJson(primary.profile) !== canonicalJson(secondary.profile)) conflicts.push({ field: 'profile', primary: primary.profile, secondary: secondary.profile }); if (primary.favorite !== secondary.favorite) conflicts.push({ field: 'favorite', primary: primary.favorite, secondary: secondary.favorite }); return { primary: clone(primary), secondary: clone(secondary), merged: { ...primary, displayName, name: mergeNames(primary.name, secondary.name), emails: mergeItems(primary.emails, secondary.emails, 'normalized'), phones: mergeItems(primary.phones, secondary.phones, 'normalized'), addresses: mergeItems(primary.addresses, secondary.addresses, 'formatted'), websites: mergeItems(primary.websites, secondary.websites, 'url'), organization, dates: mergeItems(primary.dates, secondary.dates, 'kind'), notes, tags: [...new Set([...primary.tags, ...secondary.tags])].slice(0, CONTACTS_MAX_TAGS), groupIds: [...new Set([...primary.groupIds, ...secondary.groupIds])].slice(0, CONTACTS_MAX_GROUPS), favorite: primary.favorite || secondary.favorite, avatar: primary.avatar ?? secondary.avatar, profile: primary.profile ?? secondary.profile, identityLinks: mergeItems(primary.identityLinks, secondary.identityLinks, 'identityId'), externalHandles: mergeItems(primary.externalHandles, secondary.externalHandles, 'kind:value'), sourceUids: [...new Set([...primary.sourceUids, ...secondary.sourceUids])].slice(0, 128), updatedAt: primary.updatedAt, revision: Math.max(primary.revision, secondary.revision), tombstone: false, deletedAt: undefined, mergedInto: undefined }, conflicts, survivingId: primary.id, redirectedId: secondary.id }; }
function mergeItems<T extends { readonly id: ContactFieldId }>(left: readonly T[], right: readonly T[], key: string): readonly T[] { const output = new Map<string, T>(); for (const value of [...left, ...right]) { const candidate = value as T & Record<string, unknown>; const compound = key.includes(':') ? key.split(':').map(part => String(candidate[part] ?? '')).join(':') : String(candidate[key] ?? ''); if (!output.has(compound)) output.set(compound, value); } return [...output.values()].slice(0, 64); }
function mergeNames(left: ContactName, right: ContactName): ContactName { return { displayName: left.displayName ?? right.displayName, givenName: left.givenName ?? right.givenName, familyName: left.familyName ?? right.familyName, middleName: left.middleName ?? right.middleName, prefix: left.prefix ?? right.prefix, suffix: left.suffix ?? right.suffix, nickname: left.nickname ?? right.nickname }; }

function normalizeName(value: ContactName | undefined, displayName?: string): ContactName { const input = value ?? {}; const explicitDisplayName = input.displayName ?? displayName; const result: ContactName = { ...(explicitDisplayName ? { displayName: boundedText(explicitDisplayName, 240) } : {}), ...(input.givenName ? { givenName: boundedText(input.givenName, 120) } : {}), ...(input.familyName ? { familyName: boundedText(input.familyName, 120) } : {}), ...(input.middleName ? { middleName: boundedText(input.middleName, 120) } : {}), ...(input.prefix ? { prefix: boundedText(input.prefix, 80) } : {}), ...(input.suffix ? { suffix: boundedText(input.suffix, 80) } : {}), ...(input.nickname ? { nickname: boundedText(input.nickname, 120) } : {}) }; return result; }
function fallbackDisplayName(name: ContactName, email?: string): string { return name.givenName || name.familyName ? [name.givenName, name.middleName, name.familyName].filter(Boolean).join(' ') : name.nickname ?? email ?? 'Unnamed contact'; }
function normalizeEmails(values: readonly ContactEmailInput[] | undefined, provenance: ContactFieldProvenance, previous: readonly ContactEmail[] = []): readonly ContactEmail[] { return normalizeFieldItems(values ?? [], previous, value => { const normalized = normalizeEmail(value.value); return { version: 1, id: itemId(value.id, previous, normalized, value.label), value: boundedRequired(value.value, 320, 'Email'), normalized, ...(value.label ? { label: boundedText(value.label, 80) } : {}), preferred: value.preferred === true, provenance: provenanceFor(value, provenance), ...(value.verified !== undefined ? { verified: value.verified === true } : {}) }; }, CONTACTS_MAX_EMAILS); }
function normalizePhones(values: readonly ContactPhoneInput[] | undefined, provenance: ContactFieldProvenance, previous: readonly ContactPhone[] = []): readonly ContactPhone[] { return normalizeFieldItems(values ?? [], previous, value => { const normalized = normalizePhone(value.value, value.region); return { version: 1, id: itemId(value.id, previous, normalized, value.label), value: boundedRequired(value.value, 128, 'Phone'), normalized, ...(value.label ? { label: boundedText(value.label, 80) } : {}), preferred: value.preferred === true, provenance: provenanceFor(value, provenance) }; }, CONTACTS_MAX_PHONES); }
function normalizeAddresses(values: readonly ContactAddressInput[] | undefined, provenance: ContactFieldProvenance, previous: readonly ContactAddress[] = []): readonly ContactAddress[] { return normalizeFieldItems(values ?? [], previous, value => ({ version: 1, id: itemId(value.id, previous, `${value.formatted ?? ''}:${value.street ?? ''}`, value.label), ...(value.label ? { label: boundedText(value.label, 80) } : {}), ...(value.street ? { street: boundedText(value.street, 512) } : {}), ...(value.locality ? { locality: boundedText(value.locality, 160) } : {}), ...(value.region ? { region: boundedText(value.region, 160) } : {}), ...(value.postalCode ? { postalCode: boundedText(value.postalCode, 80) } : {}), ...(value.country ? { country: boundedText(value.country, 160) } : {}), ...(value.formatted ? { formatted: boundedText(value.formatted, 1_024) } : {}), provenance: provenanceFor(value, provenance) }), CONTACTS_MAX_ADDRESSES); }
function normalizeWebsites(values: readonly ContactWebsiteInput[] | undefined, provenance: ContactFieldProvenance, previous: readonly ContactWebsite[] = []): readonly ContactWebsite[] { return normalizeFieldItems(values ?? [], previous, value => ({ version: 1, id: itemId(value.id, previous, value.url, value.label), ...(value.label ? { label: boundedText(value.label, 80) } : {}), url: sanitizeContactWebsite(value.url), provenance: provenanceFor(value, provenance) }), CONTACTS_MAX_WEBSITES); }
function normalizeDates(values: readonly ContactDateInput[] | undefined, provenance: ContactFieldProvenance, previous: readonly ContactDate[] = []): readonly ContactDate[] { return normalizeFieldItems(values ?? [], previous, value => { if (!['BIRTHDAY', 'ANNIVERSARY', 'CUSTOM'].includes(String(value.kind ?? 'CUSTOM')) || !Number.isInteger(value.month) || !Number.isInteger(value.day) || value.month < 1 || value.month > 12 || value.day < 1 || value.day > daysInMonth(value.month, value.year)) throw new ContactError('INVALID_ARGUMENT', 'Contact date is invalid'); return { version: 1, id: itemId(value.id, previous, `${value.kind ?? 'CUSTOM'}:${value.month}:${value.day}:${value.year ?? ''}`, value.label), kind: value.kind ?? 'CUSTOM', ...(value.label ? { label: boundedText(value.label, 80) } : {}), month: value.month, day: value.day, ...(value.year === undefined ? {} : { year: boundedInt(value.year, 1, 9_999, 1) }), provenance: provenanceFor(value, provenance) }; }, CONTACTS_MAX_DATES); }
function normalizeOrganization(value: ContactOrganization): ContactOrganization { return { ...(value.name ? { name: boundedText(value.name, 240) } : {}), ...(value.department ? { department: boundedText(value.department, 160) } : {}), ...(value.jobTitle ? { jobTitle: boundedText(value.jobTitle, 240) } : {}) }; }
function provenanceFor(value: unknown, fallback: ContactFieldProvenance): ContactFieldProvenance { const candidate = isRecord(value) ? value.provenance : undefined; return candidate === 'OWNER_ENTERED' || candidate === 'IMPORTED_VCARD' || candidate === 'IMPORTED_CSV' || candidate === 'NEARBY_CARD' || candidate === 'PROFILE' ? candidate : fallback; }
function normalizeStringList(values: readonly string[] | undefined, maxItems: number, maxBytes: number): readonly string[] { if (values && values.length > maxItems) throw new ContactError('BOUNDS_EXCEEDED', 'Contact list bound exceeded'); const result: string[] = []; for (const value of values ?? []) { const normalized = safeText(value, maxBytes); if (!normalized) continue; if (!result.includes(normalized)) result.push(normalized); } return result; }
function normalizeTags(values: readonly string[] | undefined): readonly string[] { return normalizeStringList(values, CONTACTS_MAX_TAGS, 80); }
function normalizeGroupIds(values: readonly (ContactGroupId | string)[] | undefined): readonly ContactGroupId[] { return [...new Set((values ?? []).filter(value => safeId(value, 512)).map(value => asGroupId(value)))].slice(0, CONTACTS_MAX_GROUPS); }
function normalizeExternalHandles(values: readonly ContactExternalHandleInput[] | undefined, provenance: ContactFieldProvenance, previous: readonly ContactExternalHandle[] = []): readonly ContactExternalHandle[] { return normalizeFieldItems(values ?? [], previous, value => ({ version: 1, id: itemId(value.id, previous, `${value.kind}:${value.value}`, value.label), kind: value.kind, value: boundedRequired(value.value, 2_048, 'External handle'), ...(value.label ? { label: boundedText(value.label, 80) } : {}), ...(value.kind === 'EMAIL' ? { normalized: normalizeEmail(value.value) } : value.kind === 'PHONE' ? { normalized: normalizePhone(value.value) } : {}), provenance: provenanceFor(value, provenance) }), CONTACTS_MAX_EXTERNAL_HANDLES); }
function normalizeIdentityLinks(values: readonly ContactIdentityLinkInput[] | undefined, ownerIdentityId: NodeId, now: string, preserveVerified = false): readonly ContactIdentityLink[] { return [...new Map((values ?? []).filter(value => safeId(value.identityId, 512)).map(value => { const proof = normalizeIdentityProof(value.proof, value.identityId); const persisted = value as ContactIdentityLink & ContactIdentityLinkInput; const state = preserveVerified && ['UNLINKED', 'SUGGESTED', 'LINKED', 'STALE_REVOKED'].includes(String(persisted.state)) ? persisted.state : 'LINKED'; const verified = state === 'LINKED' && preserveVerified && persisted.verified === true && proof?.source === 'CANONICAL_IDENTITY'; const id = safeId(persisted.id, 256) ? asFieldId(persisted.id) : asFieldId(proof?.identityId ? `identity-link:${proof.identityId}` : randomId('contact-identity')); const linkedAt = preserveVerified ? validIso(persisted.linkedAt) ?? now : now; const linkedBy = preserveVerified && safeId(persisted.linkedBy, 512) ? persisted.linkedBy : ownerIdentityId; const updatedAt = preserveVerified ? validIso(persisted.updatedAt) ?? now : now; return [value.identityId, { version: 1 as const, id, identityId: value.identityId, state, provenance: value.provenance ?? 'OWNER_CONFIRMED', verified, ...(proof ? { proof } : {}), linkedAt, linkedBy, updatedAt }]; })) .values()].slice(0, 32); }
function normalizeIdentityProof(value: unknown, identityId: NodeId): ContactIdentityProof | undefined { if (!isRecord(value) || value.version !== 1 || value.identityId !== identityId || !['CANONICAL_IDENTITY', 'OWNER_CONFIRMED'].includes(String(value.source))) return undefined; const publicKey = safeText(value.publicKey, 8_192); const signature = safeText(value.signature, 8_192); return { version: 1, identityId, source: value.source as ContactIdentityProof['source'], ...(publicKey ? { publicKey } : {}), ...(signature ? { signature } : {}) }; }
function normalizeProfile(value: ContactProfileInput | ContactProfileRef): ContactProfileRef { if (!safeId(value.identityId, 512)) throw new ContactError('INVALID_ARGUMENT', 'Profile identity is invalid'); return { version: 1, identityId: value.identityId, ...(value.displayName ? { displayName: boundedText(value.displayName, 240) } : {}), ...(value.bio ? { bio: boundedText(value.bio, 4_000) } : {}), ...(value.avatarUri ? { avatarUri: safeAvatarUri(value.avatarUri) } : {}), ...(value.publicLinks ? { publicLinks: normalizeWebsites(value.publicLinks as ContactWebsiteInput[], 'PROFILE') } : {}), revision: boundedInt(value.revision, 1, Number.MAX_SAFE_INTEGER, 1), updatedAt: validIso(value.updatedAt) ?? iso(0) }; }
function normalizeAvatar(value: ContactAvatarInput | ContactAvatar): ContactAvatar { const source = value.source ?? 'LOCAL_OVERRIDE'; const uri = safeAvatarUri(value.uri); if (uri.startsWith('data:')) { const comma = uri.indexOf(','); const encoded = comma >= 0 ? uri.slice(comma + 1) : ''; if (encoded.length > CONTACTS_MAX_AVATAR_BYTES * 2) throw new ContactError('BOUNDS_EXCEEDED', 'Avatar exceeds its byte bound'); } return { version: 1, source, uri, ...(value.mimeType ? { mimeType: safeText(value.mimeType, 128) } : {}), ...(value.contentId ? { contentId: safeText(value.contentId, 256) } : {}) }; }
function normalizeFieldItems<TInput extends { readonly id?: string }, TOutput extends { readonly id: ContactFieldId }>(values: readonly TInput[], previous: readonly TOutput[], convert: (value: TInput) => TOutput, max: number): readonly TOutput[] { if (values.length > max) throw new ContactError('BOUNDS_EXCEEDED', 'Contact multi-value field bound exceeded'); const used = new Set<string>(); return values.map(value => { const output = convert(value); if (used.has(output.id)) throw new ContactError('INVALID_ARGUMENT', 'Contact field id is duplicated'); used.add(output.id); return output; }); }
function itemId(id: string | undefined, previous: readonly { readonly id: ContactFieldId }[], key: string, label?: string): ContactFieldId { if (id && safeId(id, 256)) return asFieldId(id); const existing = previous.find(value => !label || (value as { label?: string }).label === label && canonicalComparable(value) === normalizeComparable(key)); return existing?.id ?? asFieldId(randomId('contact-field')); }

function parseDateInput(value: string): ContactDateInput { const trimmed = boundedRequired(value, 64, 'Contact date'); const yearless = trimmed.match(/^--(\d{1,2})[-/](\d{1,2})$/); const separated = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/); if (yearless) return { kind: 'BIRTHDAY', month: Number(yearless[1]), day: Number(yearless[2]) }; if (separated) return { kind: 'CUSTOM', year: Number(separated[1]), month: Number(separated[2]), day: Number(separated[3]) }; if (compact) return { kind: 'CUSTOM', year: Number(compact[1]), month: Number(compact[2]), day: Number(compact[3]) }; throw new ContactError('INVALID_IMPORT', 'Contact date is invalid'); }
function daysInMonth(month: number, year?: number): number { return new Date(Date.UTC(year ?? 2_024, month, 0)).getUTCDate(); }
function sanitizeContactWebsite(value: string): string { if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > CONTACTS_MAX_URL_BYTES) throw new ContactError('UNSAFE_URL', 'Contact website URL is invalid'); let url: URL; try { url = new URL(value); } catch { throw new ContactError('UNSAFE_URL', 'Contact website URL is invalid'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new ContactError('UNSAFE_URL', 'Only credential-free HTTP(S) website URLs are allowed'); return url.toString(); }
export { sanitizeContactWebsite };
function safeAvatarUri(value: string): string { if (typeof value !== 'string' || value.length > CONTACTS_MAX_URL_BYTES * 2 || /[\u0000-\u001f\u007f]/.test(value)) throw new ContactError('INVALID_ARGUMENT', 'Avatar reference is invalid'); if (value.startsWith('data:image/')) { if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value)) throw new ContactError('INVALID_ARGUMENT', 'Embedded avatar data is invalid'); return value; } if (/^keystone:\/\/(?:content|photo)\/[A-Za-z0-9._:/-]+$/i.test(value)) return value; if (/^https:\/\//i.test(value)) return value; throw new ContactError('INVALID_ARGUMENT', 'Avatar reference scheme is not allowed'); }
function normalizeEmail(value: string): string { const input = boundedRequired(value, 320, 'Email').normalize('NFC'); const at = input.lastIndexOf('@'); if (at <= 0 || at === input.length - 1 || /[\s\u0000-\u001f\u007f]/.test(input)) throw new ContactError('INVALID_ARGUMENT', 'Email address is invalid'); return `${input.slice(0, at)}@${input.slice(at + 1).toLocaleLowerCase('en-US')}`; }
function normalizePhone(value: string, region?: string): string { const input = boundedRequired(value, 128, 'Phone').normalize('NFC'); const digits = input.replace(/[^0-9+]/g, ''); if (digits.startsWith('+') && /^\+[0-9]{7,15}$/.test(digits)) return digits; if (region && /^[A-Za-z]{2}$/.test(region) && /^\d{7,15}$/.test(digits)) return `local:${region.toUpperCase()}:${digits}`; if (/^\d{3,20}$/.test(digits)) return `local:${digits}`; return `entered:${input}`; }
function normalizeComparable(value: string): string { return value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }
function canonicalComparable(value: unknown): string { return normalizeComparable(typeof value === 'string' ? value : canonicalJson(value)); }
function searchableText(value: ContactRecord, groups: ReadonlyMap<ContactGroupId, ContactGroup>, includeNotes: boolean): string { return normalizeComparable([value.displayName, value.name.givenName, value.name.familyName, value.name.middleName, value.name.nickname, ...value.emails.map(item => item.value), ...value.phones.map(item => item.value), ...value.addresses.map(item => item.formatted ?? ''), ...value.websites.map(item => item.url), value.organization?.name ?? '', value.organization?.department ?? '', value.organization?.jobTitle ?? '', ...value.tags, ...value.groupIds.map(id => groups.get(id)?.name ?? ''), ...(includeNotes ? [value.notes ?? ''] : [])].join(' ')); }
function tokenize(value: string): readonly string[] { return [...new Set(normalizeComparable(value).split(/[^\p{L}\p{N}@+._:-]+/u).filter(Boolean))].slice(0, CONTACTS_MAX_SEARCH_TOKENS); }
function canonicalJson(value: unknown): string { return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested) ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested); }
function serializedBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function safeId(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function safeText(value: unknown, max: number): string { return typeof value === 'string' && new TextEncoder().encode(value).byteLength <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : ''; }
function boundedText(value: string, max: number): string { const result = safeText(value, max); if (!result) throw new ContactError('INVALID_ARGUMENT', 'Contact text is invalid'); return result; }
function boundedRequired(value: unknown, max: number, field: string): string { const result = safeText(value, max); if (!result) throw new ContactError('INVALID_ARGUMENT', `${field} is required`); return result; }
function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }
function validIso(value: unknown): string | undefined { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined; return new Date(Date.parse(value)).toISOString(); }
function iso(value: number): string { return new Date(value).toISOString(); }
function randomId(prefix: string): string { return `${prefix}:${crypto.randomUUID()}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function asContactId(value: ContactId | string): ContactId { if (!safeId(value, 512)) throw new ContactError('INVALID_ARGUMENT', 'Contact id is invalid'); return value as ContactId; }
function asGroupId(value: ContactGroupId | string): ContactGroupId { if (!safeId(value, 512)) throw new ContactError('INVALID_ARGUMENT', 'Contact group id is invalid'); return value as ContactGroupId; }
function asFieldId(value: string): ContactFieldId { if (!safeId(value, 256)) throw new ContactError('INVALID_ARGUMENT', 'Contact field id is invalid'); return value as ContactFieldId; }
function asCardId(value: string): ContactCardId { if (!safeId(value, 256)) throw new ContactError('INVALID_ARGUMENT', 'Contact card id is invalid'); return value as ContactCardId; }
function asImportId(value: string): ContactImportId { if (!safeId(value, 256)) throw new ContactError('INVALID_ARGUMENT', 'Contact import id is invalid'); return value as ContactImportId; }
function compareContacts(a: ContactRecord, b: ContactRecord): number { return a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id); }
function paginate(values: readonly ContactRecord[], options: { readonly limit?: number; readonly cursor?: string }): ContactPage { const limit = boundedInt(options.limit, 1, CONTACTS_MAX_PAGE, CONTACTS_MAX_PAGE); const start = options.cursor ? Math.max(0, values.findIndex(value => value.id === options.cursor) + 1) : 0; const items = values.slice(start, start + limit).map(clone); return { items, total: values.length, ...(start + limit < values.length && items.length ? { nextCursor: items[items.length - 1]!.id } : {}) }; }
function scalarFields(value: ContactRecord): readonly string[] { return ['kind', 'name', 'displayName', 'displayNameOverride', 'organization', 'notes', 'tags', 'groupIds', 'favorite', 'avatar', 'profile', 'sourceUids']; }
function multiValueFields(value: ContactRecord): readonly [string, readonly { readonly id: ContactFieldId }[]][] { return [['emails', value.emails], ['phones', value.phones], ['addresses', value.addresses], ['websites', value.websites], ['dates', value.dates], ['identityLinks', value.identityLinks], ['externalHandles', value.externalHandles]]; }
function sameField(a: ContactRecord, b: ContactRecord, field: string): boolean { return canonicalJson((a as unknown as Record<string, unknown>)[field]) === canonicalJson((b as unknown as Record<string, unknown>)[field]); }
function compareVersion(a: ContactVersion, b: ContactVersion): number { return a.clock - b.clock || a.deviceId.localeCompare(b.deviceId) || a.eventId.localeCompare(b.eventId); }
function strongest(a: ContactDuplicateCandidate['strength'], b: ContactDuplicateCandidate['strength']): ContactDuplicateCandidate['strength'] { return strengthRank(a) >= strengthRank(b) ? a : b; }
function strengthRank(value: ContactDuplicateCandidate['strength']): number { return value === 'STRONG' ? 3 : value === 'MEDIUM' ? 2 : 1; }
function uniqueStrings(values: readonly string[]): readonly string[] { return [...new Set(values.filter(Boolean))]; }
function uniqueMailAddresses(values: readonly MailAddress[]): readonly MailAddress[] { const seen = new Set<string>(); return values.filter(value => { const key = `${normalizeEmail(value.address)}:${value.name ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 256); }
function firstProp(map: Map<string, VCardProperty[]>, name: string): VCardProperty | undefined { return map.get(name)?.[0]; }
function hasPref(prop: VCardProperty): boolean { return prop.params.PREF === '1' || prop.params.TYPE?.toLocaleLowerCase().includes('pref') === true; }
function firstPhoto(values: readonly VCardProperty[]): ContactAvatarInput | undefined { for (const prop of values) { if (prop.binary && prop.binary.byteLength <= CONTACTS_MAX_VCARD_PHOTO_BYTES) { const type = (prop.params.TYPE ?? 'image/jpeg').toLocaleLowerCase(); if (/^image\/(png|jpeg|jpg|webp|gif)$/.test(type)) return { source: 'IMPORTED_VCARD', mimeType: type, uri: `data:${type};base64,${bytesToBase64(prop.binary)}` }; } if (/^data:image\//i.test(prop.value) && prop.value.length <= CONTACTS_MAX_AVATAR_BYTES * 2) { try { return { source: 'IMPORTED_VCARD', uri: safeAvatarUri(prop.value) }; } catch { return undefined; } } } return undefined; }
function decodeBase64Bounded(value: string, maxBytes: number): Uint8Array { const compact = value.replace(/\s+/g, ''); if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length > maxBytes * 2) throw new ContactError('BOUNDS_EXCEEDED', 'Encoded vCard data exceeds its bound'); try { const binary = Uint8Array.from(atob(compact), char => char.charCodeAt(0)); if (binary.byteLength > maxBytes) throw new ContactError('BOUNDS_EXCEEDED', 'Encoded vCard data exceeds its bound'); return binary; } catch (error) { if (error instanceof ContactError) throw error; throw new ContactError('INVALID_IMPORT', 'Encoded vCard data is invalid'); } }
function bytesToBase64(value: Uint8Array): string { let output = ''; for (let index = 0; index < value.length; index += 0x8000) output += String.fromCharCode(...value.subarray(index, Math.min(value.length, index + 0x8000))); return btoa(output); }
function decodeQuotedPrintable(value: string): string { return value.replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))); }
function unescapeVCard(value: string): string { return value.replace(/\\([nN,;\\:])/g, (_match, char: string) => char.toLowerCase() === 'n' ? '\n' : char); }
function escapeVCard(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/:/g, '\\:'); }
function foldVCardLine(value: string): string { const chars = [...value]; const lines: string[] = []; let current = ''; for (const char of chars) { if (new TextEncoder().encode(current + char).byteLength > 75) { lines.push(current); current = ` ${char}`; } else current += char; } if (current || !lines.length) lines.push(current); return lines.join('\r\n'); }
function findUnquoted(value: string, separator: string): number { let quoted = false; for (let index = 0; index < value.length; index += 1) { if (value[index] === '"') quoted = !quoted; else if (value[index] === separator && !quoted) return index; } return -1; }
function normalizeCardEmails(value: unknown): readonly Pick<ContactEmail, 'value' | 'label' | 'preferred'>[] { if (!Array.isArray(value)) throw new ContactError('INVALID_ARGUMENT', 'Contact card emails are invalid'); return value.slice(0, CONTACTS_MAX_EMAILS).filter(isRecord).flatMap(item => { try { return [{ value: boundedRequired(item.value, 320, 'Email'), ...(typeof item.label === 'string' && item.label ? { label: boundedText(item.label, 80) } : {}), preferred: item.preferred === true }]; } catch { return []; } }); }
function normalizeCardPhones(value: unknown): readonly Pick<ContactPhone, 'value' | 'label' | 'preferred'>[] { if (!Array.isArray(value)) throw new ContactError('INVALID_ARGUMENT', 'Contact card phones are invalid'); return value.slice(0, CONTACTS_MAX_PHONES).filter(isRecord).flatMap(item => { try { return [{ value: boundedRequired(item.value, 128, 'Phone'), ...(typeof item.label === 'string' && item.label ? { label: boundedText(item.label, 80) } : {}), preferred: item.preferred === true }]; } catch { return []; } }); }
function normalizeCardAddresses(value: unknown): readonly Omit<ContactAddress, 'version' | 'id' | 'provenance'>[] { if (!Array.isArray(value)) throw new ContactError('INVALID_ARGUMENT', 'Contact card addresses are invalid'); return value.slice(0, CONTACTS_MAX_ADDRESSES).filter(isRecord).map(item => ({ ...(typeof item.label === 'string' ? { label: boundedText(item.label, 80) } : {}), ...(typeof item.street === 'string' ? { street: boundedText(item.street, 512) } : {}), ...(typeof item.locality === 'string' ? { locality: boundedText(item.locality, 160) } : {}), ...(typeof item.region === 'string' ? { region: boundedText(item.region, 160) } : {}), ...(typeof item.postalCode === 'string' ? { postalCode: boundedText(item.postalCode, 80) } : {}), ...(typeof item.country === 'string' ? { country: boundedText(item.country, 160) } : {}), ...(typeof item.formatted === 'string' ? { formatted: boundedText(item.formatted, 1_024) } : {}) })); }
function normalizeCardWebsites(value: unknown): readonly Pick<ContactWebsite, 'url' | 'label'>[] { if (!Array.isArray(value)) throw new ContactError('INVALID_ARGUMENT', 'Contact card websites are invalid'); return value.slice(0, CONTACTS_MAX_WEBSITES).filter(isRecord).flatMap(item => { try { return [{ url: sanitizeContactWebsite(boundedRequired(item.url, CONTACTS_MAX_URL_BYTES, 'Website')), ...(typeof item.label === 'string' && item.label ? { label: boundedText(item.label, 80) } : {}) }]; } catch { return []; } }); }
function normalizeCardDates(value: unknown): readonly Pick<ContactDate, 'kind' | 'label' | 'month' | 'day' | 'year'>[] { if (!Array.isArray(value)) throw new ContactError('INVALID_ARGUMENT', 'Contact card dates are invalid'); return value.slice(0, CONTACTS_MAX_DATES).filter(isRecord).flatMap(item => { if (!['BIRTHDAY', 'ANNIVERSARY', 'CUSTOM'].includes(String(item.kind)) || !Number.isInteger(item.month) || !Number.isInteger(item.day)) return []; return [{ kind: item.kind as ContactDateKind, ...(typeof item.label === 'string' ? { label: boundedText(item.label, 80) } : {}), month: item.month as number, day: item.day as number, ...(Number.isInteger(item.year) ? { year: item.year as number } : {}) }]; }); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function csvCell(value: string): string { const text = String(value); const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text; return /[",\r\n]/.test(protectedText) ? `"${protectedText.replace(/"/g, '""')}"` : protectedText; }
