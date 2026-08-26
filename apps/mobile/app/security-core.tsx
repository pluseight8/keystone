import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { i18n, type ImmutableCoreSnapshot } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from '../src/settingsRuntime';

/**
 * Minimal recovery UI for the immutable security core.  It deliberately has
 * no "ignore" action: only a host-provided verification/repair boundary may
 * leave lockdown.
 */
export default function SecurityCoreScreen() {
  const [runtime, setRuntime] = useState(getMobileSettingsRuntime);
  const [locale, setLocale] = useState(i18n.getLocale());
  const [snapshot, setSnapshot] = useState<ImmutableCoreSnapshot>();
  useEffect(() => subscribeMobileSettingsRuntime(() => setRuntime(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { setSnapshot(runtime?.immutableCore?.snapshot()); }, [runtime]);
  const ru = locale === 'ru';
  const core = runtime?.immutableCore;
  const refresh = () => setSnapshot(core?.snapshot());
  const invoke = async (action?: () => Promise<void>) => { if (!action) return; await action(); refresh(); };
  const status = snapshot?.officialStatus ?? 'UNVERIFIED_BUILD';
  const locked = snapshot?.locked === true || snapshot?.stage === 'LOCKDOWN';
  return <View style={styles.screen}>
    <View style={styles.header}><Label>{ru ? 'Целостность Keystone' : 'Keystone Build Integrity'}</Label><Text style={styles.muted}>{ru ? 'Проверка release-signed core выполняется до privileged runtime.' : 'The release-signed core is verified before privileged runtime starts.'}</Text></View>
    <ScrollView contentContainerStyle={styles.list}>
      <Surface style={[styles.card, locked && styles.locked]}>
        <Text style={styles.title}>{ru ? 'Статус сборки' : 'Build status'}: {status}</Text>
        <Text style={styles.muted}>{ru ? 'Стадия' : 'Stage'}: {snapshot?.stage ?? (core ? 'UNVERIFIED' : 'UNVERIFIED')}</Text>
        <Text style={styles.muted}>{ru ? 'Policy epoch' : 'Policy epoch'}: {snapshot?.policyEpoch ?? '—'} · {ru ? 'Rollback epoch' : 'Rollback epoch'}: {snapshot?.rollbackEpoch ?? '—'}</Text>
        {snapshot?.manifest && <Text style={styles.muted}>{snapshot.manifest.releaseVersion} · {snapshot.manifest.securityProfileVersion} · {snapshot.manifest.platform}/{snapshot.manifest.architecture}</Text>}
        {!core && <Text style={styles.warning}>{ru ? 'Native host не подключил Immutable Core. Privileged/shared operations остаются недоступны.' : 'The native host has not attached Immutable Core. Privileged/shared operations remain unavailable.'}</Text>}
      </Surface>
      {locked && <Surface style={[styles.card, styles.locked]}>
        <Text style={styles.title}>{ru ? 'Security Lockdown' : 'Security Lockdown'}</Text>
        <Text style={styles.warning}>{ru ? 'Критические файлы изменены или повреждены. Продолжение без проверки запрещено.' : 'Security-critical files were modified or corrupted. Continuing without verification is blocked.'}</Text>
        {snapshot?.failure && <Text style={styles.muted}>{snapshot.failure.category}: {snapshot.failure.componentId ?? snapshot.failure.path ?? 'core'}{snapshot.failure.expectedHash ? ` · ${snapshot.failure.expectedHash.slice(0, 16)}…` : ''}</Text>}
        <View style={styles.actions}>
          <Action label={ru ? 'Проверить ещё раз' : 'Verify again'} onPress={() => void invoke(runtime?.integrityRecovery?.verifyAgain)} />
          <Action label={ru ? 'Восстановить host' : 'Repair host'} onPress={() => void invoke(runtime?.integrityRecovery?.repairHost)} />
          <Action label={ru ? 'Проверить recovery artifact' : 'Verify recovery artifact'} onPress={() => void invoke(runtime?.integrityRecovery?.verifyRecoveryArtifact)} />
        </View>
      </Surface>}
      <Surface style={styles.card}><Text style={styles.title}>{ru ? 'Граница доверия' : 'Trust boundary'}</Text><Text style={styles.muted}>{ru ? 'Remote official=true, модель, Skill или plugin не получают authority. Только локально проверенный manifest и MandatoryPolicyRoot могут открыть privileged runtime.' : 'Remote official=true claims, models, Skills and plugins never gain authority. Only a locally verified manifest and MandatoryPolicyRoot can unlock privileged runtime.'}</Text></Surface>
    </ScrollView>
  </View>;
}

function Action({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.action}><Text style={styles.actionText}>{label}</Text></Pressable>; }
const styles = { screen: { flex: 1, padding: 16, gap: 12, backgroundColor: tokens.colors.background }, header: { gap: 4 }, list: { gap: 8 }, card: { padding: 12, gap: 8 }, locked: { borderWidth: 1, borderColor: '#b3261e' }, title: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted }, warning: { color: '#b3261e' }, actions: { gap: 8 }, action: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: tokens.colors.surface }, actionText: { color: tokens.colors.text } };
