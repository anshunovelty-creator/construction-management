import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadFirms } from '../../between/data';
import { addPlace, switchPlace } from '../supplied/actions';
import type { Place } from '../supplied/data';

/** Where labour is supplied: our own firms' sites, and outside customers. */
export default async function LabourPlacesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner', 'office');
  const [t, { error }] = await Promise.all([getTranslations(), searchParams]);
  const db = await createClient();
  const [{ data: places }, firms, { data: sites }, { data: clients }] = await Promise.all([
    db.from('labour_places').select('*').order('name').returns<Place[]>(),
    loadFirms(db),
    db.from('sites').select('id, name').eq('is_active', true).order('name'),
    db.from('parties').select('id, name').eq('kind', 'client').eq('is_active', true).order('name'),
  ]);
  const options = (rows: { id: string; name: string }[] | null) => (rows ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>);

  return (
    <>
      <Link href="/labour/supplied" className="back"><Icon name="chevronLeft" size={16} /> {t('supplied.title')}</Link>
      <h1>{t('supplied.places')}</h1>
      <p className="lede">{t('supplied.placesLede')}</p>
      {error && <p className="banner bad" role="alert">{t(`labour.errors.${error}`)}</p>}
      <form action={addPlace} className="card labour-form">
        <h2 className="labour-form-title">{t('supplied.addSite')}</h2>
        <input type="hidden" name="kind" value="site" />
        <div className="field"><label htmlFor="p-firm">{t('fields.firm_id')}</label>
          <select id="p-firm" name="firm" required defaultValue=""><option value="">{t('bankbook.popup.pick')}</option>{options(firms.filter((f) => !f.runs_labour))}</select></div>
        <div className="field"><label htmlFor="p-site">{t('fields.site_id')}</label>
          <select id="p-site" name="site" required defaultValue=""><option value="">{t('bankbook.popup.pick')}</option>{options(sites)}</select></div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('supplied.add')}</button></div>
      </form>
      <form action={addPlace} className="card labour-form">
        <h2 className="labour-form-title">{t('supplied.addClient')}</h2>
        <input type="hidden" name="kind" value="client" />
        <div className="field"><label htmlFor="p-client">{t('fields.client_id')}</label>
          <select id="p-client" name="client" required defaultValue=""><option value="">{t('bankbook.popup.pick')}</option>{options(clients)}</select>
          <p className="hint">{t('supplied.clientHint')} <Link href="/masters/parties" className="underline">{t('party.goSetup')}</Link></p></div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('supplied.add')}</button></div>
      </form>
      {(places ?? []).length > 0 && (
        <div className="card table-wrap flush"><table className="ledger">
          <thead><tr><th>{t('supplied.place')}</th><th>{t('fields.kind')}</th><th /></tr></thead>
          <tbody>
            {(places ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.name}{!p.is_active && <span className="pill common">{t('bankbook.off')}</span>}</td>
                <td>{t(p.firm_id ? 'supplied.ourSite' : 'supplied.outside')}</td>
                <td><form action={switchPlace.bind(null, p.id, !p.is_active)}><button type="submit" className="btn ghost small">{t(p.is_active ? 'supplied.switchOff' : 'supplied.switchOn')}</button></form></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
