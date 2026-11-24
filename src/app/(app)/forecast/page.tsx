import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { RupeesInput } from '@/components/form';
import { PrintButton } from '@/components/print-button';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { forecast, KINDS, shortages } from '@/lib/forecast';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../entries/data';
import { MoneyCell, Stat } from '../party/shared';
import { addPlan, keepForecast, removePlan } from './actions';
import { loadForecast } from './data';

const ERRORS = new Set(['plan', 'date', 'not_saved']);

/** What of the money held is really ours to spend, and the eight weeks ahead. Worked out from the books; nothing moves. */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ firms?: string; error?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [working, t, asked] = await Promise.all([getWorkingFirm(), getTranslations(), searchParams]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const all = profile.role === 'owner' && asked.firms === 'all';
  const today = todayInIndia();
  const db = await createClient();
  // The owner's all-firm view needs every firm; one firm's needs only its own.
  const { firms, shared } = await loadForecast(db, all ? working.firms : [working.firm], today);
  const sum = (key: 'held' | 'gst' | 'tds' | 'salary' | 'wages' | 'clientExtra' | 'otherFirms' | 'partiesDue') => firms.reduce((s, f) => s + f[key], 0);
  const weeks = forecast(sum('held'), [...firms.flatMap((f) => f.items), ...(all ? shared.items : [])], today);
  const lines: [string, number][] = [
    ['gst', sum('gst')], ['tds', sum('tds')], ...(all ? [['pf', shared.pf] as [string, number]] : []),
    ['salary', sum('salary') + (all ? shared.salary : 0)], ['wages', sum('wages')], ['clientExtra', sum('clientExtra')],
    ...(all ? [['rent', shared.rent] as [string, number]] : [['otherFirms', sum('otherFirms')] as [string, number]]),
  ];
  const notOurs = lines.reduce((s, [, amount]) => s + amount, 0);
  const free = sum('held') - notOurs;
  const short = all ? shortages(firms.map((f) => ({ name: f.name, weeks: forecast(f.held, f.items, today) }))) : [];
  const kept = db.from('kept_forecasts').select('made_on, weeks').order('made_on', { ascending: false }).limit(6);
  const { data: keeps } = await (all ? kept.is('firm_id', null) : kept.eq('firm_id', working.firm.id)).returns<{ made_on: string; weeks: { end: string; closing: number }[] }[]>();
  const over = (keeps ?? []).flatMap((k) => k.weeks.filter((w) => w.end < today).map((w) => ({ made: k.made_on, ...w })));
  const actual = await Promise.all(over.map((o) => db.rpc('money_at', { p_firm: all ? null : working.firm.id, p_date: o.end })));
  const day = (date: string) => showDate(date).replace(/ \d{4}$/, '');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('forecast.title')}</h1>
          <p className="lede">{t('forecast.lede')}</p>
        </div>
        <div className="day-picker no-print">
          {profile.role === 'owner' && <nav className="filters" aria-label={t('bankbook.show')}>
            <Link href="/forecast" className={`chip${all ? '' : ' on'}`}>{working.firm.name}</Link>
            <Link href="/forecast?firms=all" className={`chip${all ? ' on' : ''}`}>{t('bankbook.allFirms')}</Link>
          </nav>}
          <PrintButton label={t('ledger.print')} />
        </div>
      </div>

      <div className="stats">
        <Stat label={t('forecast.held')} value={showPaise(sum('held'))} />
        <Stat label={t('forecast.notOurs')} value={showPaise(notOurs)} tone="owe" />
        <Stat label={t('forecast.free')} value={showPaise(free)} tone={free < 0 ? 'owe' : 'done'} />
        <Stat label={t('forecast.afterParties')} value={showPaise(free - sum('partiesDue'))} tone={free - sum('partiesDue') < 0 ? 'owe' : undefined} note={t('forecast.afterPartiesNote', { amount: showPaise(sum('partiesDue')) })} />
      </div>
      <dl className="bill-totals">
        <div><dt>{t('forecast.held')}</dt><dd>{showPaise(sum('held'))}</dd></div>
        {lines.filter(([, amount]) => amount !== 0).map(([key, amount]) => <div key={key}><dt>{t(`forecast.lines.${key}`)}</dt><dd className="minus">{showPaise(amount)}</dd></div>)}
        <div className="grand"><dt>{t('forecast.free')}</dt><dd className={free < 0 ? 'minus' : 'plus'}>{showPaise(free)}</dd></div>
      </dl>

      <h2>{t('forecast.weeksTitle')}</h2>
      {short.map((s) => (
        <p key={s.name} className="banner bad">
          <span>{t('forecast.short', { firm: s.name, amount: showPaise(s.short), week: day(weeks[s.week]!.from) })}{' '}
            {s.spare.length > 0 ? t('forecast.spare', { who: s.spare.map((o) => `${o.name} ${showPaise(o.amount)}`).join(', ') }) : t('forecast.noSpare')}</span>
        </p>
      ))}
      {!all && weeks.some((w) => w.closing < 0) && <p className="banner bad">{t('forecast.runsShort', { week: day(weeks.find((w) => w.closing < 0)!.from) })}</p>}
      <div className="card table-wrap flush">
        <table className="ledger forecast">
          <thead><tr><th />{weeks.map((w) => <th key={w.from} className="num">{day(w.from)} – {day(w.to)}</th>)}</tr></thead>
          <tbody>
            <tr><td><strong>{t('flow.start')}</strong></td>{weeks.map((w) => <td key={w.from} className={`num${w.opening < 0 ? ' minus' : ''}`}>{showPaise(w.opening)}</td>)}</tr>
            {KINDS.filter((k) => weeks.some((w) => w.kinds[k])).map((k) => (
              <tr key={k}><td>{t(`forecast.kinds.${k}`)}</td>{weeks.map((w) => <MoneyCell key={w.from} paise={Math.abs(w.kinds[k] ?? 0)} tone={(w.kinds[k] ?? 0) > 0 ? 'plus' : 'minus'} />)}</tr>
            ))}
          </tbody>
          <tfoot><tr><td>{t('flow.end')}</td>{weeks.map((w) => <td key={w.from} className={`num strong${w.closing < 0 ? ' minus' : ''}`}>{showPaise(w.closing)}</td>)}</tr></tfoot>
        </table>
      </div>
      <p className="hint">{t(all ? 'forecast.noteAll' : 'forecast.note')}</p>

      {!all && (
        <section className="ledger-section" id="plans">
          <h2>{t('forecast.plansTitle')}</h2>
          <p className="hint">{t('forecast.plansHint')}</p>
          {asked.error && ERRORS.has(asked.error) && <p className="banner bad" role="alert">{t(`forecast.errors.${asked.error}`)}</p>}
          <form action={addPlan.bind(null, working.firm.id)} className="card labour-form no-print">
            <div className="field"><label htmlFor="f-name">{t('forecast.plan.name')}</label><input id="f-name" name="name" required placeholder={t('forecast.plan.example')} /></div>
            <div className="field"><label htmlFor="f-direction">{t('fields.direction')}</label>
              <select id="f-direction" name="direction" defaultValue="out"><option value="out">{t('forecast.plan.out')}</option><option value="in">{t('forecast.plan.in')}</option></select></div>
            <div className="field"><label htmlFor="f-amount">{t('labour.amount')}</label><RupeesInput input={{ id: 'f-amount', name: 'amount', required: true }} /></div>
            <div className="field"><label htmlFor="f-repeats">{t('forecast.plan.repeats')}</label>
              <select id="f-repeats" name="repeats" defaultValue="month">{['once', 'week', 'month'].map((r) => <option key={r} value={r}>{t(`forecast.plan.${r}`)}</option>)}</select></div>
            <div className="field"><label htmlFor="f-next">{t('forecast.plan.next')}</label><input id="f-next" type="date" name="next_on" required defaultValue={today} /></div>
            <div className="field"><label htmlFor="f-until">{t('forecast.plan.until')} <span className="optional">{t('common.optional')}</span></label><input id="f-until" type="date" name="until_on" /></div>
            <div className="labour-form-end"><button type="submit" className="btn">{t('forecast.plan.add')}</button></div>
          </form>
          {firms[0]!.plans.length > 0 && (
            <div className="card table-wrap flush"><table className="ledger">
              <thead><tr><th>{t('forecast.plan.name')}</th><th className="num">{t('bankbook.in')}</th><th className="num">{t('bankbook.out')}</th><th>{t('forecast.plan.repeats')}</th><th>{t('forecast.plan.next')}</th><th className="no-print" /></tr></thead>
              <tbody>{firms[0]!.plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><MoneyCell paise={p.direction === 'in' ? Number(p.amount_paise) : 0} tone="plus" /><MoneyCell paise={p.direction === 'out' ? Number(p.amount_paise) : 0} tone="minus" />
                  <td>{t(`forecast.plan.${p.repeats}`)}</td><td className="nowrap">{showDate(p.next_on)}{p.until_on && ` – ${showDate(p.until_on)}`}{p.repeats === 'once' && p.next_on < today && <span className="pill pending">{t('forecast.plan.late')}</span>}</td>
                  <td className="no-print"><form action={removePlan.bind(null, p.id)}><button type="submit" className="btn ghost small">{t('labour.remove')}</button></form></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      <section className="ledger-section" id="kept">
        <h2>{t('forecast.keptTitle')}</h2>
        <p className="hint">{t('forecast.keptHint')}</p>
        <form action={keepForecast.bind(null, all)} className="no-print"><button type="submit" className="btn ghost">{t('forecast.keep')}</button></form>
        {(keeps ?? []).length > 0 && over.length === 0 && <p className="hint">{t('forecast.keptOn', { date: showDate(keeps![0]!.made_on) })}</p>}
        {over.length > 0 && (
          <div className="card table-wrap flush"><table className="ledger">
            <thead><tr><th>{t('forecast.madeOn')}</th><th>{t('forecast.weekEnd')}</th><th className="num">{t('forecast.expected')}</th><th className="num">{t('forecast.actual')}</th><th className="num">{t('match.difference')}</th></tr></thead>
            <tbody>{over.map((o, i) => {
              const was = Number(actual[i]!.data ?? 0);
              return <tr key={`${o.made}${o.end}`}><td className="nowrap">{showDate(o.made)}</td><td className="nowrap">{showDate(o.end)}</td><MoneyCell paise={o.closing} /><MoneyCell paise={was} /><MoneyCell paise={was - o.closing} tone={was < o.closing ? 'minus' : 'plus'} /></tr>;
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
