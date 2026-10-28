import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// The dev server is also opened as 127.0.0.1; without this Next blocks its scripts there and no button works.
const nextConfig: NextConfig = { allowedDevOrigins: ['127.0.0.1'] };

// Uses src/i18n/request.ts.
export default createNextIntlPlugin()(nextConfig);
