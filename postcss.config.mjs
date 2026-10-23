const nextConfig: NextConfig = {};

// Uses src/i18n/request.ts.
export default createNextIntlPlugin()(nextConfig);
```

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
