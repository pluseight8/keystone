import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { i18n } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileTasksRuntime, subscribeMobileTasksRuntime, type MobileTask, type MobileTaskView, type MobileTasksRuntime } from '../src/tasksRuntime';

type MobileTaskScreenView = Exclude<MobileTaskView, 'ASSIGNED_TO_ME'>;
const views: readonly MobileTaskScreenView[] = ['INBOX', 'TODAY', 'UPCOMING', 'ALL', 'COMPLETED', 'OVERDUE', 'SOMEDAY', 'SHARED', 'TRASH'];

export default function TasksScreen() {
  const [runtime, setRuntime] = useState<MobileTasksRuntime | undefined>(getMobileTasksRuntime);
  const [locale, setLocale] = useState(i18n.getLocale);
  const [view, setView] = useState<MobileTaskScreenView>('INBOX');
  const [items, setItems] = useState<readonly MobileTask[]>([]);
  const [total, setTotal] = useState(0);
  const [quick, setQuick] = useState('');
  const [preview, setPreview] = useState<ReturnType<MobileTasksRuntime['previewQuickCapture']>>();
  const [notice, setNotice] = useState('');
  const ru = locale === 'ru';
  const copy = ru ? russian : english;

  useEffect(() => subscribeMobileTasksRuntime(() => setRuntime(getMobileTasksRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { if (!quick.trim() || !runtime) { setPreview(undefined); return; } try { setPreview(runtime.previewQuickCapture(quick, { locale: ru ? 'ru' : 'en' })); } catch { setPreview(undefined); } }, [quick, ru, runtime]);
  const refresh = async () => { if (!runtime) return; try { const page = await runtime.tasks({ view, includeTrash: view === 'TRASH', limit: 128 }); setItems(page.items); setTotal(page.total); setNotice(''); } catch { setNotice(copy.unavailable); } };
  useEffect(() => { void refresh(); if (!runtime?.subscribe) return undefined; return runtime.subscribe(() => { void refresh(); }); }, [runtime, view, locale]);
  const add = async () => { if (!runtime || !quick.trim()) return; try { await runtime.quickCapture(quick.trim(), { locale: ru ? 'ru' : 'en' }); setQuick(''); setPreview(undefined); await refresh(); } catch { setNotice(copy.unavailable); } };
  const toggle = async (task: MobileTask) => { if (!runtime) return; try { if (task.status === 'COMPLETED') await runtime.reopen(task.id); else await runtime.complete(task.id); await refresh(); } catch { setNotice(copy.unavailable); } };

  if (!runtime) return <View style={styles.empty}><Text style={styles.emptyIcon}>✓</Text><Label>{copy.title}</Label><Text style={styles.muted}>{copy.unavailable}</Text><Text style={styles.detail}>{copy.boundary}</Text></View>;
  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.content}><View style={styles.header}><View><Label>{copy.title}</Label><Text style={styles.muted}>{copy.subtitle}</Text></View><KeystoneButton onPress={() => void refresh()}>{copy.refresh}</KeystoneButton></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.viewRow}>{views.map(value => <Pressable key={value} onPress={() => setView(value)} style={[styles.view, view === value && styles.viewActive]}><Text style={view === value ? styles.viewTextActive : styles.viewText}>{copy[value]}</Text></Pressable>)}</ScrollView><View style={styles.quick}><TextInput value={quick} onChangeText={setQuick} onSubmitEditing={() => void add()} returnKeyType="done" placeholder={copy.add} placeholderTextColor={tokens.colors.muted} style={styles.input}/><KeystoneButton onPress={() => void add()}>{copy.addShort}</KeystoneButton></View>{preview && <Surface style={styles.preview}><Text style={styles.previewLabel}>{copy.preview}</Text><Text style={styles.title}>{preview.title}</Text>{preview.due && <Text style={styles.muted}>{copy.due}: {preview.due.value}{preview.ambiguous ? ` · ${copy.ambiguous}` : ''}</Text>}</Surface>}{notice ? <Text style={styles.notice}>{notice}</Text> : null}{items.length ? items.map(task => <TaskRow key={task.id} task={task} copy={copy} onToggle={() => void toggle(task)} />) : <Surface style={styles.note}><Text style={styles.title}>{copy.empty}</Text><Text style={styles.muted}>{copy.boundary}</Text></Surface>}<Text style={styles.count}>{total} · {copy.local}</Text></ScrollView></View>;
}

type TaskCopy = typeof english | typeof russian;
function TaskRow({ task, copy, onToggle }: { task: MobileTask; copy: TaskCopy; onToggle: () => void }) {
  return <Surface style={styles.task}><Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked: task.status === 'COMPLETED' }} style={styles.check}><Text style={styles.checkText}>{task.status === 'COMPLETED' ? '✓' : '○'}</Text></Pressable><View style={styles.taskBody}><Text style={[styles.title, task.status === 'COMPLETED' && styles.done]}>{task.title}</Text><Text style={styles.muted}>{task.priority !== 'NONE' ? task.priority : ''}{task.due ? ` · ${copy.due} ${task.due.value}` : ''}{task.tags.length ? ` · ${task.tags.join(', ')}` : ''}</Text></View></Surface>;
}

const english = { title: 'Tasks', subtitle: 'Personal planning · local-first', INBOX: 'Inbox', TODAY: 'Today', UPCOMING: 'Upcoming', ALL: 'All', COMPLETED: 'Completed', OVERDUE: 'Overdue', SOMEDAY: 'Someday', SHARED: 'Shared', TRASH: 'Trash', add: 'Quick capture…', addShort: 'Add', preview: 'Preview', due: 'Due', ambiguous: 'Ambiguous date', empty: 'No tasks in this view.', refresh: 'Refresh', local: 'local-first', unavailable: 'TaskService is not connected on this device.', boundary: 'The native host must install TaskService, Chronos reminder integration and the authenticated replication adapter.' } as const;
const russian = { title: 'Задачи', subtitle: 'Личное планирование · local-first', INBOX: 'Входящие', TODAY: 'Сегодня', UPCOMING: 'Предстоящие', ALL: 'Все', COMPLETED: 'Завершённые', OVERDUE: 'Просроченные', SOMEDAY: 'Когда-нибудь', SHARED: 'Общие', TRASH: 'Корзина', add: 'Быстрый ввод…', addShort: 'Добавить', preview: 'Предпросмотр', due: 'Срок', ambiguous: 'Дата неоднозначна', empty: 'В этом представлении задач нет.', refresh: 'Обновить', local: 'сначала локально', unavailable: 'TaskService не подключён на этом устройстве.', boundary: 'Нативный host должен установить TaskService, интеграцию напоминаний Chronos и аутентифицированный replication adapter.' } as const;
const styles = { screen: { flex: 1, backgroundColor: tokens.colors.background }, content: { padding: 16, gap: 12, paddingBottom: 42 }, header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12 }, muted: { color: tokens.colors.muted, fontSize: 12 }, detail: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18 }, title: { color: tokens.colors.text, fontSize: 15, fontWeight: '600' as const }, viewRow: { gap: 6 }, view: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: tokens.colors.surface }, viewActive: { backgroundColor: tokens.colors.accent }, viewText: { color: tokens.colors.muted, fontSize: 11 }, viewTextActive: { color: '#fff', fontSize: 11, fontWeight: '600' as const }, quick: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const }, input: { flex: 1, minHeight: 42, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: tokens.colors.surface, color: tokens.colors.text }, preview: { padding: 11, gap: 4, borderColor: tokens.colors.accent }, previewLabel: { color: tokens.colors.accent, fontSize: 10, textTransform: 'uppercase' as const }, notice: { color: tokens.colors.critical }, task: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12 }, check: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: tokens.colors.border, alignItems: 'center' as const, justifyContent: 'center' as const }, checkText: { color: tokens.colors.accent, fontSize: 17 }, taskBody: { flex: 1, gap: 4 }, done: { textDecorationLine: 'line-through' as const, color: tokens.colors.muted }, note: { padding: 13, gap: 5 }, count: { color: tokens.colors.muted, fontSize: 10 }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 9, backgroundColor: tokens.colors.background }, emptyIcon: { color: tokens.colors.accent, fontSize: 34 } };
