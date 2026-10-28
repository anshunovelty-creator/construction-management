import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// The dev server is also opened as 127.0.0.1; without this Next blocks its scripts there and no button works.
const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  // Going back to a page seen in the last 30 seconds is instant; every save refreshes it (revalidatePath).
  // The main menu's pages, loaded ahead of time, are kept for 30 seconds too (Next's default is 5 minutes).
  experimental: { staleTimes: { dynamic: 30, static: 30 } },
};

// Uses src/i18n/request.ts.
export default createNextIntlPlugin()(nextConfig);
