import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {};

// Uses src/i18n/request.ts.
export default createNextIntlPlugin()(nextConfig);
