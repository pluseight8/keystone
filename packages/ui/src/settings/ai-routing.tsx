import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { KeystoneConfig } from '@keystone/core/src/config/schema';
import { useTranslation } from '../i18n';

export interface TrustedAiDevice { id: string; name: string; role: 'Self' | 'Family' | 'Friend' | 'Addon'; online: boolean; isDesktop?: boolean; }

/** Settings surface for selecting a trusted desktop master and controlling its server policy. */
export function AiRoutingSettings({ config, onChange, devices, isDesktop = false }: { config: KeystoneConfig; onChange: (config: KeystoneConfig) => void; devices: readonly TrustedAiDevice[]; isDesktop?: boolean }) {
  const selfDevices = devices.filter(device => device.role === 'Self');
  const { t } = useTranslation();
  return <View style={styles.section}>
    <Text style={styles.title}>{t('ai.title')}</Text>
    <Text style={styles.description}>{t('ai.description')}</Text>
    <View style={styles.divider} />
    {selfDevices.length === 0 ? <Text style={styles.muted}>{t('ai.none')}</Text> : selfDevices.map(device => {
      const selected = config.masterAiNodeId === device.id;
      return <View key={device.id} style={[styles.device, selected && styles.selected]}>
        <View style={styles.deviceCopy}><Text style={styles.deviceName}>{device.name}</Text><Text style={styles.meta}>{device.online ? t('ai.online') : t('ai.offline')} · SELF{device.isDesktop ? ` · ${t('nodes.desktop')}` : ''}</Text></View>
        <Pressable disabled={!device.online || !device.isDesktop} accessibilityRole="button" accessibilityState={{ disabled: !device.online || !device.isDesktop }} onPress={() => onChange({ ...config, masterAiNodeId: selected ? null : device.id })} style={[styles.button, selected && styles.buttonActive, (!device.online || !device.isDesktop) && styles.disabled]}><Text style={styles.buttonText}>{selected ? t('ai.master') : t('ai.set_master')}</Text></Pressable>
      </View>;
    })}
    {isDesktop && <View style={styles.policy}><View style={styles.policyCopy}><Text style={styles.deviceName}>{t('ai.accept_requests')}</Text><Text style={styles.meta}>{t('ai.policy')}</Text></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: config.allowRemoteInference }} onPress={() => onChange({ ...config, allowRemoteInference: !config.allowRemoteInference })} style={[styles.toggle, config.allowRemoteInference && styles.toggleActive]}><View style={[styles.knob, config.allowRemoteInference && styles.knobOn]} /></Pressable></View>}
  </View>;
}

const styles = StyleSheet.create({ section: { backgroundColor: '#121212', borderWidth: 1, borderColor: '#2a2a2a', padding: 20, gap: 16, maxWidth: 920, width: '100%', alignSelf: 'center' }, title: { color: '#f5f5f5', fontSize: 24, fontWeight: '800' }, description: { color: '#a3a3a3', fontSize: 13 }, divider: { height: 1, backgroundColor: '#2a2a2a' }, device: { minHeight: 68, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, selected: { borderColor: '#990000' }, deviceCopy: { flex: 1, gap: 5 }, deviceName: { color: '#f5f5f5', fontSize: 13, fontWeight: '700' }, meta: { color: '#a3a3a3', fontSize: 11, fontWeight: '600' }, muted: { color: '#a3a3a3', fontSize: 12 }, button: { minHeight: 40, borderWidth: 1, borderColor: '#2a2a2a', paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#000' }, buttonActive: { borderColor: '#990000', backgroundColor: '#990000' }, buttonText: { color: '#f5f5f5', fontSize: 11, fontWeight: '800' }, disabled: { opacity: 0.45 }, policy: { minHeight: 68, borderTopWidth: 1, borderColor: '#2a2a2a', paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, policyCopy: { flex: 1, gap: 5 }, toggle: { width: 48, height: 26, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000', padding: 3 }, toggleActive: { borderColor: '#990000', backgroundColor: '#990000' }, knob: { width: 18, height: 18, backgroundColor: '#a3a3a3' }, knobOn: { marginLeft: 20, backgroundColor: '#fff' } });
