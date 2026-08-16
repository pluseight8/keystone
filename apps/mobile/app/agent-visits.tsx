import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { i18n, type AgentCapabilityGrant, type AgentInvitation, type AgentRoom, type AgentVisit } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from '../src/settingsRuntime';

/**
 * Host-neutral UI for signed agent visits and temporary Agent Rooms.
 * The native host owns identity keys and the transport; this screen only
 * displays metadata and asks the core service to perform explicit actions.
 */
export default function AgentVisitsScreen() {
  const [runtime, setRuntime] = useState(getMobileSettingsRuntime);
  const [locale, setLocale] = useState(i18n.getLocale);
  const [invitations, setInvitations] = useState<readonly AgentInvitation[]>([]);
  const [visits, setVisits] = useState<readonly AgentVisit[]>([]);
  const [rooms, setRooms] = useState<readonly AgentRoom[]>([]);
  const ru = locale === 'ru';
  const service = runtime?.visits;
  const refresh = () => {
    if (!service) { setInvitations([]); setVisits([]); setRooms([]); return; }
    void Promise.all([service.listInvitations(), service.listVisits(), service.listRooms()]).then(([nextInvitations, nextVisits, nextRooms]) => {
      setInvitations(nextInvitations); setVisits(nextVisits); setRooms(nextRooms);
    });
  };
  useEffect(() => subscribeMobileSettingsRuntime(() => setRuntime(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(refresh, [runtime]);
  const accept = (invitation: AgentInvitation) => {
    if (!service || invitation.status !== 'pending' || !invitation.requestedCapabilities.length) return;
    const grants: AgentCapabilityGrant[] = invitation.requestedCapabilities.map((request, index) => ({
      ...request,
      grantId: `mobile-grant-${invitation.id}-${index}`,
      issuedAt: new Date().toISOString(),
      expiresAt: invitation.expiresAt,
      maxUses: 8,
    }));
    void service.acceptInvitation(invitation.id, { capabilities: grants, approvalMode: 'ALLOW_THIS_VISIT' }).then(refresh);
  };
  const revoke = (visit: AgentVisit) => { if (!service) return; void service.revokeVisit(visit.id, ru ? 'Отозвано пользователем' : 'Revoked by user').then(refresh).catch(() => undefined); };
  if (!service) return <View style={styles.empty}><Label>{ru ? 'Гостевые визиты недоступны' : 'Agent visits are not configured'}</Label><Text style={styles.muted}>{ru ? 'Native host должен установить signed AgentVisitService.' : 'The native host must install the signed AgentVisitService.'}</Text></View>;
  return <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><Label>{ru ? 'Визиты AI-агентов' : 'Agent visits'}</Label><Text style={styles.muted}>{ru ? 'Гость получает только явно выданные, подписанные и ограниченные capabilities. Private Memory не передаётся.' : 'Guests receive only explicitly granted, signed and bounded capabilities. Private Memory never crosses the visit.'}</Text></View>
    <Surface style={styles.card}><Label>{ru ? 'Приглашения' : 'Invitations'}</Label>{invitations.length ? invitations.slice().reverse().map(invitation => <View key={invitation.id} style={styles.item}><View style={styles.row}><Text style={styles.text}>{invitation.visitor.agentId} → {invitation.host.agentId}</Text><Text style={styles.badge}>{invitation.status}</Text></View><Text style={styles.muted}>{ru ? 'Capabilities' : 'Capabilities'}: {invitation.requestedCapabilities.map(value => value.toolId ? `${value.capability}:${value.toolId}` : value.capability).join(', ') || '—'}</Text><Text style={styles.muted}>{ru ? 'Истекает' : 'Expires'}: {invitation.expiresAt}</Text>{invitation.status === 'pending' ? <KeystoneButton onPress={() => accept(invitation)}>{ru ? 'Принять явно' : 'Accept explicitly'}</KeystoneButton> : null}</View>) : <Text style={styles.muted}>{ru ? 'Нет приглашений.' : 'No invitations.'}</Text>}</Surface>
    <Surface style={styles.card}><Label>{ru ? 'Активные и завершённые визиты' : 'Visits'}</Label>{visits.length ? visits.slice().reverse().map(visit => <View key={visit.id} style={styles.item}><View style={styles.row}><Text style={styles.text}>{visit.visitor.agentId} ↔ {visit.host.agentId}</Text><Text style={styles.badge}>{visit.status}</Text></View><Text style={styles.muted}>{ru ? 'Режим подтверждения' : 'Approval'}: {visit.approvalMode} · {ru ? 'capabilities' : 'capabilities'}: {visit.capabilities.map(value => value.capability).join(', ')}</Text><Text style={styles.muted}>{ru ? 'ID визита' : 'Visit ID'}: {visit.id}</Text>{visit.status === 'active' ? <KeystoneButton onPress={() => revoke(visit)}>{ru ? 'Отозвать' : 'Revoke'}</KeystoneButton> : null}</View>) : <Text style={styles.muted}>{ru ? 'Визитов пока нет.' : 'No visits yet.'}</Text>}</Surface>
    <Surface style={styles.card}><Label>{ru ? 'Agent Rooms' : 'Agent Rooms'}</Label><Text style={styles.muted}>{ru ? 'В Room находится только явно расшаренный PUBLIC/USER_EXPLICIT контекст.' : 'Rooms contain only explicitly shared PUBLIC/USER_EXPLICIT context.'}</Text>{rooms.length ? rooms.slice().reverse().map(room => <View key={room.id} style={styles.item}><View style={styles.row}><Text style={styles.text}>{room.title}</Text><Text style={styles.badge}>{room.status}</Text></View><Text style={styles.muted}>{ru ? 'Участники' : 'Members'}: {room.members.map(value => value.agent.agentId).join(', ')}</Text><Text style={styles.muted}>{ru ? 'Shared context' : 'Shared context'}: {room.sharedContext.map(value => value.label).join(', ') || '—'}</Text></View>) : <Text style={styles.muted}>{ru ? 'Комнат пока нет.' : 'No rooms yet.'}</Text>}</Surface>
  </ScrollView>;
}

const styles = { screen: { padding: 16, gap: 12, backgroundColor: tokens.colors.background }, header: { gap: 6 }, card: { padding: 14, gap: 10 }, item: { borderWidth: 1, borderColor: tokens.colors.border, padding: 12, gap: 6 }, row: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 }, text: { color: tokens.colors.text, flex: 1 }, muted: { color: tokens.colors.muted }, badge: { color: tokens.colors.accent, fontSize: 12 }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 8, backgroundColor: tokens.colors.background } };
