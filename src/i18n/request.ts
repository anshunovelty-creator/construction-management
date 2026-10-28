import { getRequestConfig } from 'next-intl/server';

// The app is in English only.
export default getRequestConfig(async () => ({ locale: 'en', messages: (await import('../../messages/en.json')).default }));
