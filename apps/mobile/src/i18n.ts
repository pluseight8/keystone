import { i18n, type Locale } from '@keystone/core';
import { useEffect, useState } from 'react';
import { getLocales } from 'react-native-localize';

/** Offline locale source backed by the device's native locale settings. */
i18n.configureDetector(() => getLocales()[0]?.languageTag);

/** Renders React Native screens from the same persisted locale used by shared settings. */
export function useMobileLocale(): Locale {
  const [locale, setLocale] = useState(i18n.getLocale);
  useEffect(() => i18n.subscribe(setLocale), []);
  return locale;
}
