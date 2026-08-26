import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { i18n } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { Label, Surface } from '@keystone/ui';

/** Metadata-only secret inventory view. It intentionally has no reveal action. */
export default function SecretsScreen() {
  const [locale, setLocale] = useState(i18n.getLocale());
  useEffect(() => i18n.subscribe(setLocale), []);
  const ru = locale === 'ru';
  return <View style={styles.screen}>
    <View style={styles.header}><Label>{ru ? 'Секреты и ключи' : 'Secrets & keys'}</Label><Text style={styles.muted}>{ru ? 'Показываются только безопасные метаданные. Значения ключей никогда не отображаются.' : 'Only safe metadata is shown. Key values are never displayed.'}</Text></View>
    <ScrollView contentContainerStyle={styles.list}>
      <Surface style={styles.card}><Text style={styles.title}>{ru ? 'Secret host' : 'Secret host'}</Text><Text style={styles.muted}>MEMORY_ONLY · {ru ? 'уровень host должен подтверждаться платформой' : 'the host must report its real platform security level'}</Text></Surface>
      <Surface style={styles.card}><Text style={styles.title}>{ru ? 'Identity private key' : 'Identity private key'}</Text><Text style={styles.muted}>{ru ? 'OPAQUE HANDLE · NON_EXPORTABLE' : 'OPAQUE HANDLE · NON_EXPORTABLE'}</Text></Surface>
      <Surface style={styles.card}><Text style={styles.title}>{ru ? 'Provider credentials' : 'Provider credentials'}</Text><Text style={styles.muted}>{ru ? 'Только adapter authorization; AI и renderer значения не получают.' : 'Adapter authorization only; AI and renderer never receive values.'}</Text></Surface>
      <Surface style={styles.card}><Text style={styles.title}>{ru ? 'Recovery export' : 'Recovery export'}</Text><Text style={styles.muted}>{ru ? 'Требует явного owner confirmation и одноразового expiring intent.' : 'Requires explicit owner confirmation and a one-use expiring intent.'}</Text></Surface>
    </ScrollView>
  </View>;
}

const styles = { screen: { flex: 1, padding: 16, gap: 12, backgroundColor: tokens.colors.background }, header: { gap: 4 }, list: { gap: 8 }, card: { padding: 12, gap: 8 }, title: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted } };
