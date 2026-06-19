import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Single-path i18n: persist the chosen locale in a cookie that getRequestConfig
// (src/i18n/request.ts) reads on every server render.
const locales = ['de', 'en'] as const;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const requested = typeof body?.locale === 'string' ? body.locale : '';
  const locale = (locales as readonly string[]).includes(requested) ? requested : 'de';

  const cookieStore = await cookies();
  cookieStore.set('locale', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // ~1 year
    sameSite: 'lax',
  });

  return NextResponse.json({ locale });
}
