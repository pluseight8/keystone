import { getLocales } from 'react-native-localize';
import { i18n } from '@keystone/core';

/** Offline locale source backed by the device's native locale settings. */
i18n.configureDetector(() => getLocales()[0]?.languageTag);
export const mobileI18n = i18n;
