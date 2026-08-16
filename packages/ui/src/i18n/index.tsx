import * as React from 'react';
import { i18n, type Locale } from '@keystone/core';
export function useTranslation() {
  const [, redraw] = React.useState(0);
  React.useEffect(() => { void i18n.detect(); return i18n.subscribe(() => redraw(value => value + 1)); }, []);
  return { t: React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key, params), []), locale: i18n.getLocale(), setLocale: (locale: Locale) => i18n.setLocale(locale) };
}
export { i18n };
