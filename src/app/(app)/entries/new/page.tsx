import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { ENTRY_FORMS } from '@/lib/masters/registry';

export default async function NewEntryPage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  const forms = Object.entries(ENTRY_FORMS).filter(([, form]) => (form.roles as string[]).includes(profile.role));

  return (
    <>
      <p className="eyebrow">{t('entries.new.eyebrow')}</p>
      <h1>{t('entries.new.title')}</h1>
      <p className="lede">{t('entries.new.lede')}</p>
      <ul className="tiles">
        {forms.map(([slug, form]) => (
          <li key={slug}>
            <Link href={`/entries/new/${slug}`} className="tile">
              <span className="tile-icon" aria-hidden="true">{form.icon}</span>
              <span className="tile-title">{t(`entryForms.${slug}.title`)}</span>
              <span className="tile-when">{t(`entryForms.${slug}.when`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6">
        <Link href="/entries/sheet" className="btn ghost">▦ {t('sheet.fromNew')}</Link>
      </p>
    </>
  );
}
