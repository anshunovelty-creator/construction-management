import type { getTranslations } from 'next-intl/server';
import type { LabourWorker } from './data';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** A worker's name and salary for a day. With `worker` it changes them; the salary box then also asks from which month. */
export function WorkerForm({ action, worker, rate, today, head, families, familyLocked, t }: {
  action: (data: FormData) => Promise<void>;
  /** For a new worker: "new" starts a family with them as its head, a head's id adds them to that family. */
  head?: string;
  /** When changing a worker: every head of family, to move them into a family or out of one. */
  families?: { id: string; name: string }[];
  /** A head with members or money given stays the head. */
  familyLocked?: boolean;
  worker?: LabourWorker;
  rate?: number;
  today: string;
  t: T;
}) {
  return (
    <form action={action} className="card labour-form">
      {head && <input type="hidden" name="head" value={head} />}
      <div className="field">
        <label htmlFor="w-name">{t('labour.name')}</label>
        <input id="w-name" name="name" required defaultValue={worker?.name} />
      </div>
      <div className="field">
        <label htmlFor="w-rate">{t('labour.rate')}</label>
        <input id="w-rate" name="rate" inputMode="decimal" required defaultValue={rate === undefined ? '' : rate / 100} />
        <input type="hidden" name="old_rate" value={rate ?? ''} />
      </div>
      {worker && (
        <div className="field">
          <label htmlFor="w-from">{t('labour.rateFrom')}</label>
          <input id="w-from" type="month" name="rate_from" defaultValue={today.slice(0, 7)} required />
          <p className="hint">{t('labour.rateFromHint')}</p>
        </div>
      )}
      <div className="field">
        <label htmlFor="w-phone">{t('labour.phone')}</label>
        <input id="w-phone" name="phone" inputMode="tel" defaultValue={worker?.phone} />
      </div>
      <div className="field">
        <label htmlFor="w-skill">{t('labour.skill')}</label>
        <input id="w-skill" name="skill" defaultValue={worker?.skill} />
      </div>
      {worker && families && (
        <div className="field wide">
          <label htmlFor="w-family">{t('labour.family')}</label>
          <select id="w-family" name="family" disabled={familyLocked}
            defaultValue={worker.head_id === worker.id ? 'head' : worker.head_id ?? ''}>
            <option value="">{t('labour.noFamily')}</option>
            <option value="head">{t('labour.ownFamily')}</option>
            {families.filter((f) => f.id !== worker.id).map((f) => <option key={f.id} value={f.id}>{t('labour.memberOf', { name: f.name })}</option>)}
          </select>
          <p className="hint">{t(familyLocked ? 'labour.familyLockedHint' : 'labour.familyHint')}</p>
        </div>
      )}
      {worker && <label className="check-line"><input type="checkbox" name="is_active" defaultChecked={worker.is_active} /> {t('labour.active')}</label>}
      <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
    </form>
  );
}
