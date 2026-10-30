import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { ENTRY_FORMS } from '@/lib/masters/registry';
import { Icon } from '@/components/icons';

export default async function NewEntryPage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  const forms = Object.entries(ENTRY_FORMS).filter(([, form]) => (form.roles as string[]).includes(profile.role));

  return (
    <>
      <h1>{t('entries.new.title')}</h1>
      <p className="lede">{t('entries.new.lede')}</p>
      <ul className="tiles">
        {forms.map(([slug, form]) => (
          <li key={slug}>
            <Link href={`/entries/new/${slug}`} className="tile">
              <span className="tile-icon"><Icon name={form.icon} size={22} /></span>
              <span className="tile-title">{t(`entryForms.${slug}.title`)}</span>
              <span className="tile-when">{t(`entryForms.${slug}.when`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6">
        <Link href="/entries/sheet" className="btn ghost"><Icon name="sheet" /> {t('sheet.fromNew')}</Link>
      </p>
    </>
  );
}
