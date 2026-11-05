import type { getTranslations } from 'next-intl/server';
import type { LabourWorker } from './data';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** A person's details and pay. With `worker` it changes them; the rate box then also asks from which month. */
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
        <label htmlFor="w-kind">{t('labour.type')}</label>
        {worker ? <input id="w-kind" value={t(`labour.kinds.${worker.kind}`)} disabled /> : (
          <select id="w-kind" name="kind" defaultValue="worker">
            <option value="worker">{t('labour.kinds.worker')}</option>
            <option value="staff">{t('labour.kinds.staff')}</option>
          </select>
        )}
      </div>
      <div className="field">
        <label htmlFor="w-rate">{t('labour.rate')}</label>
        <input id="w-rate" name="rate" inputMode="decimal" required defaultValue={rate === undefined ? '' : rate / 100} />
        <p className="hint">{t('labour.rateHint')}</p>
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
        <label htmlFor="w-joined">{t('labour.joined')}</label>
        <input id="w-joined" type="date" name="joined_on" required defaultValue={worker?.joined_on ?? today} />
      </div>
      {worker && (
        <div className="field">
          <label htmlFor="w-left">{t('labour.left')}</label>
          <input id="w-left" type="date" name="left_on" defaultValue={worker.left_on ?? ''} />
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
      <div className="field">
        <label htmlFor="w-uan">{t('labour.uan')}</label>
        <input id="w-uan" name="uan" defaultValue={worker?.uan} />
      </div>
      <div className="field">
        <label htmlFor="w-esic">{t('labour.esicNumber')}</label>
        <input id="w-esic" name="esic_number" defaultValue={worker?.esic_number} />
      </div>
      <label className="check-line"><input type="checkbox" name="pf_on" defaultChecked={worker?.pf_on ?? true} /> {t('labour.pfOn')}</label>
      <label className="check-line"><input type="checkbox" name="esic_on" defaultChecked={worker?.esic_on ?? true} /> {t('labour.esicOn')}</label>
      {worker && <label className="check-line"><input type="checkbox" name="is_active" defaultChecked={worker.is_active} /> {t('labour.active')}</label>}
      <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
    </form>
  );
}
