export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

/** Set at sign-in from the user's profile, and when they change language in Settings. */
export const LOCALE_COOKIE = 'locale';

export const LOCALE_COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' } as const;

export function toLocale(value: string | undefined): Locale {
  return value === 'hi' ? 'hi' : 'en';
}
