import type { getTranslations } from 'next-intl/server';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Where a binned record came from, in the menu's own words: "Sites", "Labour supply", "AJAX machines"... */
export const kindLabel = (t: T, kind: string) =>
  kind === 'labour-workers' ? t('nav.labour') : kind === 'machines' ? t('nav.machines') : t(`masters.${kind}`);
