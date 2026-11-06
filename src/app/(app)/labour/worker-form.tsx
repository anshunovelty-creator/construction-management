import type { getTranslations } from 'next-intl/server';
import type { LabourWorker } from './data';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** A worker's name and salary for a day. With `worker` it changes them; the salary box then also asks from which month. */
export function WorkerForm({ action, worker, rate, today, t }: {
  action: (data: FormData) => Promise<void>;
  worker?: LabourWorker;
  rate?: number;
  today: string;
  t: T;
}) {
  return (
    <form action={action} className="card labour-form">
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
      {worker && <label className="check-line"><input type="checkbox" name="is_active" defaultChecked={worker.is_active} /> {t('labour.active')}</label>}
      <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
    </form>
  );
}
