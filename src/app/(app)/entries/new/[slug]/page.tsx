import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FirmLine } from '@/components/firm-line';
import { Form } from '@/components/form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { getEntryForm } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../../masters/options';
import { loadFirmParties } from '../../../party/shared';
import { postEntryForm } from '../../actions';
import { todayInIndia } from '../../data';

export default async function EntryFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = getEntryForm(slug);
  if (!form) notFound();
  const profile = await requireProfile();
  if (!(form.roles as string[]).includes(profile.role)) redirect('/entries/new');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working && profile.role !== 'supervisor') return <p className="empty">{t('party.noFirm')}</p>;
  const db = await createClient();
  const [choices, parties] = await Promise.all([
    loadChoices(db, form.fields, working ? { working, t } : undefined),
    // A payment shows what the chosen vendor is still owed in this firm.
    slug === 'pay-vendor' && working ? loadFirmParties(db, working.firm.id) : [],
  ]);
  const owed = Object.fromEntries(parties.map((p) => [p.id, { name: p.name, paise: p.f.balance }]));

  return (
    <>
      <p className="mb-2">
        <Link href="/entries/new" className="back">← {t('entries.new.title')}</Link>
      </p>
      <div className="form-layout">
        <section className="card">
          <p className="eyebrow">
            <span aria-hidden="true">{form.icon}</span> {t('entries.new.eyebrow')}
          </p>
          <h1>{t(`entryForms.${slug}.title`)}</h1>
          <p className="lede">{t(`entryForms.${slug}.when`)}</p>
          {working && <FirmLine slug={slug} firm={working.firm} t={t} />}
          <Form
            fields={form.fields}
            defaults={{ entry_date: todayInIndia() }}
            choices={choices}
            action={postEntryForm.bind(null, slug, working?.firm.id ?? null)}
            submitLabel={t('entries.save')}
            hintPrefix={`entryForms.${slug}.hints`}
            owed={slug === 'pay-vendor' ? owed : undefined}
          />
        </section>
        <aside className="why">
          <h2 className="eyebrow">{t('entries.whatHappens')}</h2>
          <p>{t(`entryForms.${slug}.what`)}</p>
        </aside>
      </div>
    </>
  );
}
