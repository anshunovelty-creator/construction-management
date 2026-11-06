import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RupeesInput } from '@/components/form';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import { lastService, nextServiceAt, showHours, totalCost } from '@/lib/machines';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../entries/data';
import { MoneyCell, Stat } from '../../party/shared';
import { addService, removeService } from '../actions';
import { loadMachines } from '../data';

/** One machine: its last service, when the next falls due, and every service so far, newest first. */
export default async function MachinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireProfile('owner', 'office');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [machine] = await loadMachines(await createClient(), id);
  if (!machine) notFound();
  const last = lastService(machine.services);
  const today = todayInIndia();

  return (
    <>
      <Link href="/machines" className="back no-print">◄ {t('machines.title')}</Link>
      <div className="ledger-head">
        <div>
          <h1>{machine.name}</h1>
          <p className="muted">{machine.rented_to ? t('machines.withParty', { party: machine.rented_to }) : t('machines.notOnRent')}</p>
        </div>
        <div className="day-picker no-print">
          <Link href={`/machines/${machine.id}/edit`} className="btn ghost">{t('machines.change')}</Link>
          <PrintButton label={t('ledger.print')} />
        </div>
      </div>
      {error && <p className="banner bad">{t(`machines.errors.${error}`)}</p>}

      <div className="stats">
        <Stat label={t('machines.lastServiced')} value={last ? showDate(last.service_date) : t('machines.notYet')} note={last ? t('machines.atReading', { hours: showHours(last.running_hours) }) : undefined} />
        <Stat label={t('machines.lastCost')} value={showPaise(last ? Number(last.cost_paise) : 0)} />
        <Stat label={t('machines.nextAt')} value={last ? showHours(nextServiceAt(last.running_hours, machine.service_every_hours)) : '–'} note={t('machines.everyNote', { hours: showHours(machine.service_every_hours) })} />
        <Stat label={t('machines.totalCost')} value={showPaise(totalCost(machine.services))} note={t('machines.services', { count: machine.services.length })} />
      </div>

      <form action={addService.bind(null, machine.id)} className="card labour-form no-print">
        <h2 className="labour-form-title">{t('machines.addService')}</h2>
        <div className="field">
          <label htmlFor="s-date">{t('machines.date')}</label>
          <input id="s-date" type="date" name="service_date" required defaultValue={today} max={today} />
        </div>
        <div className="field">
          <label htmlFor="s-hours">{t('machines.hours')}</label>
          <input id="s-hours" name="running_hours" inputMode="decimal" required />
        </div>
        <div className="field">
          <label htmlFor="s-cost">{t('machines.cost')}</label>
          <RupeesInput input={{ id: 's-cost', name: 'cost', required: true }} />
        </div>
        <div className="field">
          <label htmlFor="s-note">{t('machines.note')}</label>
          <input id="s-note" name="note" />
        </div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('machines.save')}</button></div>
      </form>

      <h2>{t('machines.historyTitle')}</h2>
      {machine.services.length === 0 ? (
        <p className="card empty-state">{t('machines.noServices')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('machines.date')}</th>
                <th className="num">{t('machines.hours')}</th>
                <th className="num">{t('machines.cost')}</th>
                <th>{t('machines.note')}</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {[...machine.services].reverse().map((s) => (
                <tr key={s.id}>
                  <td className="nowrap">{showDate(s.service_date)}</td>
                  <td className="num">{showHours(s.running_hours)}</td>
                  <MoneyCell paise={Number(s.cost_paise)} />
                  <td>{s.note}</td>
                  <td className="no-print">
                    <form action={removeService.bind(null, machine.id, s.id)}>
                      <button type="submit" className="btn ghost small">{t('machines.remove')}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
