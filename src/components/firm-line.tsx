import type { getTranslations } from 'next-intl/server';
import type { Firm } from '@/lib/firm';
import { FIRM_FORMS } from '@/lib/masters/registry';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Above a form: the firm it is filled in, so nobody types into the wrong firm's books. */
export function FirmLine({ slug, firm, t }: { slug: string; firm: Firm; t: T }) {
  return <p className="firm-line">{t(FIRM_FORMS.has(slug) ? 'firm.for' : 'firm.workingIn', { firm: firm.name })}</p>;
}
