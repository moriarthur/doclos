import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

// Single-path i18n: locale is stored in a cookie (no /en, /de routing).
const locales = ['de', 'en'] as const;
type Locale = (typeof locales)[number];

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requested = cookieStore.get('locale')?.value;
  const locale: Locale = locales.includes(requested as Locale)
    ? (requested as Locale)
    : 'de';

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
