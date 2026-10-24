import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EntrySheet, type Column } from '@/components/entry-sheet';
import { requireProfile } from '@/lib/auth';
import { ENTRY_FORMS, ENUMS, getEntryForm } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../masters/options';
import { postEntryRows } from '../actions';
import { todayInIndia } from '../data';

/** Many entries of one kind at once, typed into rows like a spreadsheet. ?type=<entry form slug>. */
export default async function SheetPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const profile = await requireProfile();
  const slugs = Object.keys(ENTRY_FORMS).filter((s) => (getEntryForm(s)!.roles as string[]).includes(profile.role));
  const slug = type && slugs.includes(type) ? type : slugs[0]!;
  const form = getEntryForm(slug)!;
  const db = await createClient();
  const [choices, t] = await Promise.all([loadChoices(db, form.fields), getTranslations()]);

  const columns: Column[] = form.fields.map((field) => {
    const hintKey = `entryForms.${slug}.hints.${field.name}`;
    const base = {
      name: field.name,
      // Drop form hints such as "(₹)" from the short column heading; the full hint shows on hover.
      label: t(`fields.${field.name}`).replace(/\s*\(.*\)$/, ''),
      hint: t.has(hintKey) ? t(hintKey) : undefined,
      required: Boolean(field.required),
    };
    if (field.kind === 'ref') return { ...base, kind: 'select', options: choices[field.ref] ?? [] };
    if (field.kind === 'enum') {
      return { ...base, kind: 'select', options: ENUMS[field.enum].map((v) => ({ value: v, label: t(`options.${field.enum}.${v}`) })) };
    }
    return { ...base, kind: field.kind === 'rupees' || field.kind === 'date' ? field.kind : 'text' };
  });

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
      {/* A new key per type starts a fresh sheet with that type's columns. */}
      <EntrySheet key={slug} columns={columns} today={todayInIndia()} save={postEntryRows.bind(null, slug)} />
    </>
  );
}
