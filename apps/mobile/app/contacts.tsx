import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { i18n } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileContactsRuntime, subscribeMobileContactsRuntime, type MobileContact, type MobileContactsRuntime } from '../src/contactsRuntime';

type ContactView = 'ALL' | 'FAVORITES' | 'PEOPLE' | 'ORGANIZATIONS' | 'TRASH';
const views: readonly ContactView[] = ['ALL', 'FAVORITES', 'PEOPLE', 'ORGANIZATIONS', 'TRASH'];

export default function ContactsScreen() {
  const [runtime, setRuntime] = useState<MobileContactsRuntime | undefined>(getMobileContactsRuntime);
  const [locale, setLocale] = useState(i18n.getLocale);
  const [view, setView] = useState<ContactView>('ALL');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<readonly MobileContact[]>([]);
  const [total, setTotal] = useState(0);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [notice, setNotice] = useState('');
  const ru = locale === 'ru';
  const copy = ru ? russian : english;

  useEffect(() => subscribeMobileContactsRuntime(() => setRuntime(getMobileContactsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  const refresh = async () => { if (!runtime) return; try { const page = await runtime.contacts({ view, query: query.trim() || undefined, includePrivateNotes: false, limit: 128 }); setItems(page.items); setTotal(page.total); setNotice(''); } catch { setNotice(copy.unavailable); } };
  useEffect(() => { void refresh(); if (!runtime?.subscribe) return undefined; return runtime.subscribe(() => { void refresh(); }); }, [runtime, view, query, locale]);
  const add = async () => { if (!runtime || !newName.trim()) return; try { await runtime.create({ displayName: newName.trim(), ...(newEmail.trim() ? { emails: [{ value: newEmail.trim(), preferred: true }] } : {}) }); setNewName(''); setNewEmail(''); await refresh(); } catch { setNotice(copy.unavailable); } };
  const toggleFavorite = async (contact: MobileContact) => { if (!runtime) return; try { await runtime.favorite(contact.id, !contact.favorite); await refresh(); } catch { setNotice(copy.unavailable); } };
  const remove = async (contact: MobileContact) => { if (!runtime) return; try { if (view === 'TRASH') await runtime.restore(contact.id); else await runtime.trash(contact.id); await refresh(); } catch { setNotice(copy.unavailable); } };

  if (!runtime) return <View style={styles.empty}><Text style={styles.emptyIcon}>◎</Text><Label>{copy.title}</Label><Text style={styles.muted}>{copy.unavailable}</Text><Text style={styles.detail}>{copy.boundary}</Text></View>;
  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.content}><View style={styles.header}><View><Label>{copy.title}</Label><Text style={styles.muted}>{copy.subtitle}</Text></View><KeystoneButton onPress={() => void refresh()}>{copy.refresh}</KeystoneButton></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.viewRow}>{views.map(value => <Pressable key={value} onPress={() => setView(value)} style={[styles.view, view === value && styles.viewActive]}><Text style={view === value ? styles.viewTextActive : styles.viewText}>{copy[value]}</Text></Pressable>)}</ScrollView><TextInput value={query} onChangeText={setQuery} placeholder={copy.search} placeholderTextColor={tokens.colors.muted} style={styles.input}/><View style={styles.create}><TextInput value={newName} onChangeText={setNewName} placeholder={copy.name} placeholderTextColor={tokens.colors.muted} style={[styles.input, styles.createInput]}/><TextInput value={newEmail} onChangeText={setNewEmail} placeholder={copy.email} placeholderTextColor={tokens.colors.muted} keyboardType="email-address" autoCapitalize="none" style={[styles.input, styles.createInput]}/><KeystoneButton onPress={() => void add()}>{copy.add}</KeystoneButton></View>{notice ? <Text style={styles.notice}>{notice}</Text> : null}{items.length ? items.map(contact => <ContactRow key={contact.id} contact={contact} copy={copy} onFavorite={() => void toggleFavorite(contact)} onRemove={() => void remove(contact)} />) : <Surface style={styles.note}><Text style={styles.title}>{copy.empty}</Text><Text style={styles.muted}>{copy.boundary}</Text></Surface>}<Text style={styles.count}>{total} · {copy.local}</Text></ScrollView></View>;
}

type ContactCopy = typeof english | typeof russian;
function ContactRow({ contact, copy, onFavorite, onRemove }: { contact: MobileContact; copy: ContactCopy; onFavorite: () => void; onRemove: () => void }) {
  const detail = contact.emails[0]?.value ?? contact.phones[0]?.value ?? contact.organization?.name ?? '';
  return <Surface style={styles.contact}><View style={styles.contactBody}><Text style={styles.title}>{contact.displayName}</Text><Text style={styles.muted}>{detail}{contact.tags.length ? ` · ${contact.tags.join(', ')}` : ''}</Text>{contact.linkedIdentityIds.length ? <Text style={styles.identity}>{copy.identity}: {contact.linkedIdentityIds.length}</Text> : null}</View><Pressable onPress={onFavorite} accessibilityLabel={copy.favorite}><Text style={styles.star}>{contact.favorite ? '★' : '☆'}</Text></Pressable><Pressable onPress={onRemove} accessibilityLabel={copy.trash}><Text style={styles.remove}>{copy.trash === 'Корзина' ? '×' : '×'}</Text></Pressable></Surface>;
}

const english = { title: 'Contacts', subtitle: 'Personal address book · local-first', search: 'Search contacts…', name: 'Name', email: 'Email', add: 'Add', ALL: 'All', FAVORITES: 'Favorites', PEOPLE: 'People', ORGANIZATIONS: 'Organizations', TRASH: 'Trash', favorite: 'Favorite', trash: 'Trash', identity: 'Linked Identities', empty: 'No contacts in this view.', refresh: 'Refresh', local: 'local-first', unavailable: 'ContactService is not connected on this device.', boundary: 'The native host must install ContactService. Contacts are not Identities, groups are not ACLs, and private notes stay out of this screen projection.' } as const;
const russian = { title: 'Контакты', subtitle: 'Личная адресная книга · local-first', search: 'Поиск контактов…', name: 'Имя', email: 'Электронная почта', add: 'Добавить', ALL: 'Все', FAVORITES: 'Избранные', PEOPLE: 'Люди', ORGANIZATIONS: 'Организации', TRASH: 'Корзина', favorite: 'Избранное', trash: 'Корзина', identity: 'Связанные Identity', empty: 'В этом представлении контактов нет.', refresh: 'Обновить', local: 'сначала локально', unavailable: 'ContactService не подключён на этом устройстве.', boundary: 'Нативный host должен установить ContactService. Контакты не являются Identity, группы не являются ACL, а приватные заметки не попадают в projection экрана.' } as const;
const styles = { screen: { flex: 1, backgroundColor: tokens.colors.background }, content: { padding: 16, gap: 12, paddingBottom: 42 }, header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12 }, muted: { color: tokens.colors.muted, fontSize: 12 }, detail: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18 }, title: { color: tokens.colors.text, fontSize: 15, fontWeight: '600' as const }, viewRow: { gap: 6 }, view: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: tokens.colors.surface }, viewActive: { backgroundColor: tokens.colors.accent }, viewText: { color: tokens.colors.muted, fontSize: 11 }, viewTextActive: { color: '#fff', fontSize: 11, fontWeight: '600' as const }, input: { minHeight: 42, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: tokens.colors.surface, color: tokens.colors.text }, create: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const }, createInput: { flex: 1 }, notice: { color: tokens.colors.critical }, contact: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12 }, contactBody: { flex: 1, gap: 4 }, identity: { color: tokens.colors.accent, fontSize: 11 }, star: { color: tokens.colors.accent, fontSize: 22 }, remove: { color: tokens.colors.muted, fontSize: 22, paddingHorizontal: 4 }, note: { padding: 13, gap: 5 }, count: { color: tokens.colors.muted, fontSize: 10 }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 9, backgroundColor: tokens.colors.background }, emptyIcon: { color: tokens.colors.accent, fontSize: 34 } };
