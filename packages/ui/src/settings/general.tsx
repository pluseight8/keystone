import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n';
export function GeneralSettings() {
  const { t, locale, setLocale } = useTranslation();
  return <View style={styles.section}><Text style={styles.title}>{t('settings.general')}</Text><Text style={styles.description}>{t('settings.language_description')}</Text><View style={styles.divider}/><Text style={styles.label}>{t('settings.language')}</Text><View style={styles.choices}>{(['en', 'ru'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: locale === value }} onPress={() => setLocale(value)} style={[styles.choice, locale === value && styles.active]}><Text style={styles.choiceText}>{t(value === 'en' ? 'settings.english' : 'settings.russian')}</Text></Pressable>)}</View></View>;
}
const styles = StyleSheet.create({ section:{backgroundColor:'#121212',borderWidth:1,borderColor:'#2a2a2a',padding:20,gap:16,maxWidth:920,width:'100%',alignSelf:'center'},title:{color:'#f5f5f5',fontSize:24,fontWeight:'800'},description:{color:'#a3a3a3',fontSize:13},divider:{height:1,backgroundColor:'#2a2a2a'},label:{color:'#f5f5f5',fontSize:13,fontWeight:'700'},choices:{flexDirection:'row',gap:8},choice:{minHeight:44,paddingHorizontal:16,justifyContent:'center',borderWidth:1,borderColor:'#2a2a2a',backgroundColor:'#000000'},active:{backgroundColor:'#990000',borderColor:'#990000'},choiceText:{color:'#f5f5f5',fontSize:13,fontWeight:'700'} });
