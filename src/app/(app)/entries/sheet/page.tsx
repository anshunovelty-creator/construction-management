import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EntrySheet } from '@/components/entry-sheet';
import { FirmLine } from '@/components/firm-line';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { ENTRY_FORMS, getEntryForm, type Field } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../masters/options';
import { postEntryRows } from '../actions';
import { todayInIndia } from '../data';
import { sheetColumns } from './columns';

/** Many entries of one kind at once, typed into rows like a spreadsheet, in the working firm. ?type=<entry form slug>. */
export default async function SheetPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const profile = await requireProfile();
  // Bills have item lines, which a row cannot hold; they are typed in their own form.
  const slugs = Object.keys(ENTRY_FORMS).filter((s) => {
    const form = getEntryForm(s)!;
    return (form.roles as string[]).includes(profile.role) && !(form.fields as Field[]).some((f) => f.kind === 'items');
  });
  const slug = type && slugs.includes(type) ? type : slugs[0]!;
  const form = getEntryForm(slug)!;
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working && profile.role !== 'supervisor') return <p className="empty">{t('party.noFirm')}</p>;
  const choices = await loadChoices(await createClient(), form.fields, working ? { working, t } : undefined);

  const columns = sheetColumns(slug, form.fields, choices, t);

  return (
    <>
      <p className="eyebrow">{t('sheet.eyebrow')}</p>
      <h1>{t('sheet.title')}</h1>
      <p className="lede">{t('sheet.lede')}</p>
      <nav className="filters" aria-label={t('sheet.eyebrow')}>
        {slugs.map((s) => (
          <Link key={s} href={`/entries/sheet?type=${s}`} className={`chip${s === slug ? ' on' : ''}`} aria-current={s === slug ? 'page' : undefined}>
            {getEntryForm(s)!.icon} {t(`entryForms.${s}.title`)}
          </Link>
        ))}
      </nav>
      <p className="hint">{t(`entryForms.${slug}.what`)}</p>
      {working && <FirmLine slug={slug} firm={working.firm} t={t} />}
      {/* A new key per type and firm starts a fresh sheet with that type's columns and that firm's lists. */}
      <EntrySheet
        key={`${slug}-${working?.firm.id}`}
        columns={columns}
        today={todayInIndia()}
        save={postEntryRows.bind(null, slug, working?.firm.id ?? null)}
      />
    </>
  );
}
