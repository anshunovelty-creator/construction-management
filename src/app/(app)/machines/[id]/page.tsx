import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AccountOptions } from '@/components/account-options';
import { RupeesInput } from '@/components/form';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import { isService, lastService, latestPaper, nextServiceAt, PAPER_NAMES, PAPERS, showHours, totalCost } from '@/lib/machines';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../entries/data';
import { MoneyCell, Stat } from '../../party/shared';
import { labourFirm, payAccounts } from '../../pay/data';
import { addPaper, addService, removeService } from '../actions';
import { PaperPill } from '../paper-pill';
import { loadMachines } from '../data';
import { Icon } from '@/components/icons';

/** One machine: its last service, when the next falls due, every service so far (newest first), and its Insurance, PUC and Fitness. */
export default async function MachinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const [machine] = await loadMachines(db, id);
  if (!machine) notFound();
  const firm = await labourFirm(db);
  const accounts = firm ? await payAccounts(db, profile.role, firm.id) : [];
  const services = machine.services.filter(isService);
  const papers = machine.services.filter((s) => !isService(s));
  const last = lastService(services);
  const today = todayInIndia();

  return (
    <>
      <Link href="/machines" className="back no-print"><Icon name="chevronLeft" size={16} /> {t('machines.title')}</Link>
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
        <Stat label={t('machines.totalCost')} value={showPaise(totalCost(services))} note={t('machines.services', { count: services.length })} />
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
          <label htmlFor="s-account">{t('pay.from')}</label>
          <select id="s-account" name="account" defaultValue=""><option value="">{t('report.other.notPaid')}</option>
            <AccountOptions accounts={accounts} /></select>
        </div>
        <div className="field">
          <label htmlFor="s-charges">{t('fields.charges')} <span className="optional">{t('common.optional')}</span></label>
          <input id="s-charges" name="charges" inputMode="decimal" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="s-note">{t('machines.note')}</label>
          <input id="s-note" name="note" />
        </div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('machines.save')}</button></div>
      </form>

      <h2>{t('machines.historyTitle')}</h2>
      {services.length === 0 ? (
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
              {[...services].reverse().map((s) => (
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

      <h2 id="papers">{t('machines.papers.title')}</h2>
      <div className="stats">
        {PAPERS.map((paper) => {
          const p = latestPaper(papers, paper);
          return (
            <div key={paper} className="stat card">
              <span className="stat-label">{PAPER_NAMES[paper]}</span>
              <span className="stat-value"><PaperPill until={p?.valid_until ?? undefined} today={today} t={t} /></span>
              {p?.paper_no && <span className="stat-note">{p.paper_no}{p.company ? ` · ${p.company}` : ''}</span>}
            </div>
          );
        })}
      </div>

      <form action={addPaper.bind(null, machine.id)} className="card labour-form no-print">
        <h2 className="labour-form-title">{t('machines.papers.add')}</h2>
        <div className="field">
          <label htmlFor="p-paper">{t('machines.papers.paper')}</label>
          <select id="p-paper" name="paper" required defaultValue="">
            <option value="">{t('bankbook.popup.pick')}</option>
            {PAPERS.map((paper) => <option key={paper} value={paper}>{PAPER_NAMES[paper]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-no">{t('machines.papers.number')}</label>
          <input id="p-no" name="paper_no" placeholder={t('machines.papers.numberHint')} />
        </div>
        <div className="field">
          <label htmlFor="p-company">{t('machines.papers.company')}</label>
          <input id="p-company" name="company" placeholder={t('machines.papers.companyHint')} />
        </div>
        <div className="field">
          <label htmlFor="p-from">{t('machines.papers.from')}</label>
          <input id="p-from" type="date" name="valid_from" required defaultValue={today} />
        </div>
        <div className="field">
          <label htmlFor="p-until">{t('machines.papers.until')}</label>
          <input id="p-until" type="date" name="valid_until" required />
        </div>
        <div className="field">
          <label htmlFor="p-cost">{t('machines.papers.cost')}</label>
          <RupeesInput input={{ id: 'p-cost', name: 'cost' }} />
        </div>
        <div className="field">
          <label htmlFor="p-account">{t('pay.from')}</label>
          <select id="p-account" name="account" defaultValue=""><option value="">{t('report.other.notPaid')}</option>
            <AccountOptions accounts={accounts} /></select>
        </div>
        <div className="field">
          <label htmlFor="p-charges">{t('fields.charges')} <span className="optional">{t('common.optional')}</span></label>
          <input id="p-charges" name="charges" inputMode="decimal" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="p-paid">{t('machines.papers.paidOn')}</label>
          <input id="p-paid" type="date" name="paid_on" required defaultValue={today} max={today} />
        </div>
        <div className="field">
          <label htmlFor="p-note">{t('machines.note')}</label>
          <input id="p-note" name="note" />
        </div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('machines.save')}</button></div>
      </form>

      {papers.length === 0 ? (
        <p className="card empty-state">{t('machines.papers.none')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('machines.papers.paper')}</th>
                <th>{t('machines.papers.number')}</th>
                <th>{t('machines.papers.company')}</th>
                <th>{t('machines.papers.from')}</th>
                <th>{t('machines.papers.until')}</th>
                <th className="num">{t('machines.papers.cost')}</th>
                <th>{t('machines.papers.paidOn')}</th>
                <th>{t('machines.note')}</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {[...papers].sort((a, b) => (b.valid_until ?? '').localeCompare(a.valid_until ?? '')).map((s) => (
                <tr key={s.id}>
                  <td>{PAPER_NAMES[s.kind as keyof typeof PAPER_NAMES]}</td>
                  <td>{s.paper_no}</td>
                  <td>{s.company}</td>
                  <td className="nowrap">{s.valid_from ? showDate(s.valid_from) : ''}</td>
                  <td className="nowrap">{s.valid_until ? showDate(s.valid_until) : ''}</td>
                  <MoneyCell paise={Number(s.cost_paise)} />
                  <td className="nowrap">{showDate(s.service_date)}</td>
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
