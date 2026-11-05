import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { ListLink } from '@/components/list-link';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { daysInMonth } from '@/lib/wages';
import { todayInIndia } from '../../entries/data';
import { saveAttendance } from '../actions';
import { loadLabour, pickMonth, showMonth } from '../data';
import { AttendanceCard, type CardDay } from './card';

/** Typing in the monthly attendance cards, one person after another, with who is still to be done below. */
export default async function LabourAttendancePage({ searchParams }: { searchParams: Promise<{ worker?: string; month?: string; saved?: string; error?: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const q = await searchParams;
  const today = todayInIndia();
  const month = pickMonth(q.month, today);
  const db = await createClient();
  const { people } = await loadLabour(db, today);
  const active = people.filter((p) => p.is_active);
  const person = people.find((p) => p.id === q.worker) ?? active[0];
  const page = (worker: string, m = month) => `/labour/attendance?worker=${worker}&month=${m}`;

  const first = `${month}-01`;
  const dim = daysInMonth(first);
  const { data: saved, error } = person
    ? await db.from('labour_attendance').select('work_date, present, ot_hours').eq('worker_id', person.id)
      .gte('work_date', first).lte('work_date', `${month}-${String(dim).padStart(2, '0')}`)
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const byDate = new Map((saved ?? []).map((r) => [r.work_date as string, r]));
  const days: CardDay[] = Array.from({ length: dim }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const row = byDate.get(date);
    return {
      n: i + 1, date,
      weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
      sunday: new Date(`${date}T00:00:00Z`).getUTCDay() === 0,
      future: date > today,
      mark: row ? (row.present ? 'P' : 'A') : '',
      ot: row && Number(row.ot_hours) > 0 ? String(Number(row.ot_hours)) : '',
    };
  });
  const place = person ? active.findIndex((p) => p.id === person.id) : -1;
  const next = place >= 0 ? active[place + 1] : undefined;

  return (
    <>
      <h1>{t('labour.attendanceTitle')}</h1>
      <p className="lede">{t('labour.attendanceLede')}</p>
      {q.saved && <p role="status" className="banner">{t('labour.cardSaved')}</p>}
      {q.error && <p className="banner bad">{t(`labour.errors.${q.error}`)}</p>}

      {!person ? (
        <p className="card empty-state">{t('labour.none')} <Link href="/labour/new" className="underline">{t('labour.addWorker')}</Link></p>
      ) : (
        <>
          <AutoForm action="/labour/attendance" className="card labour-pick">
            <div className="field">
              <label htmlFor="card-worker">{t('labour.name')}</label>
              <select key={person.id} id="card-worker" name="worker" defaultValue={person.id}>
                {people.filter((p) => p.is_active || p.id === person.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="card-month">{t('salary.month')}</label>
              <input key={month} id="card-month" type="month" name="month" defaultValue={month} max={today.slice(0, 7)} required />
            </div>
          </AutoForm>
          <h2>{person.name} · {showMonth(month)}</h2>
          {person.kind === 'staff' && <p className="hint">{t('labour.staffCardHint')}</p>}
          <AttendanceCard key={`${person.id}${month}`} days={days} staff={person.kind === 'staff'} nextId={next?.id} nextName={next?.name}
            action={saveAttendance.bind(null, person.id, month)} />

          <h2>{t('labour.cardsTitle', { month: showMonth(month) })}</h2>
          <div className="card table-wrap flush">
            <table className="ledger clickable">
              <thead>
                <tr>
                  <th>{t('labour.name')}</th>
                  <th className="num">{t('salary.present')}</th>
                  <th className="num">{t('salary.absent')}</th>
                  <th className="num">{t('salary.otHours')}</th>
                  <th>{t('labour.cardState')}</th>
                </tr>
              </thead>
              <tbody>
                {active.map((p) => {
                  const d = p.days.find((x) => x.month === month);
                  return (
                    <tr key={p.id}>
                      <td><ListLink href={page(p.id)} className="party-link">{p.name}</ListLink></td>
                      <td className="num">{d?.present ?? 0}</td>
                      <td className="num">{d?.absent ?? 0}</td>
                      <td className="num">{p.kind === 'staff' ? '–' : Number(d?.ot_hours ?? 0)}</td>
                      <td><span className={`pill ${d ? 'cleared' : 'pending'}`}>{t(d ? 'labour.cardDone' : 'labour.cardWaiting')}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
