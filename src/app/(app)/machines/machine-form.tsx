import type { getTranslations } from 'next-intl/server';
import type { Machine } from './data';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** A machine's name, who has it on rent, and the hours between services. */
export function MachineForm({ action, machine, t }: { action: (data: FormData) => Promise<void>; machine?: Machine; t: T }) {
  return (
    <form action={action} className="card labour-form">
      <div className="field">
        <label htmlFor="m-name">{t('machines.name')}</label>
        <input id="m-name" name="name" required defaultValue={machine?.name} />
        <p className="hint">{t('machines.nameHint')}</p>
      </div>
      <div className="field">
        <label htmlFor="m-rented">{t('machines.rentedTo')}</label>
        <input id="m-rented" name="rented_to" defaultValue={machine?.rented_to} />
        <p className="hint">{t('machines.rentedToHint')}</p>
      </div>
      <div className="field">
        <label htmlFor="m-every">{t('machines.every')}</label>
        <input id="m-every" name="service_every_hours" inputMode="numeric" required defaultValue={machine?.service_every_hours ?? 500} />
      </div>
      {machine && <label className="check-line"><input type="checkbox" name="is_active" defaultChecked={machine.is_active} /> {t('machines.active')}</label>}
      <div className="labour-form-end"><button type="submit" className="btn">{t('machines.save')}</button></div>
    </form>
  );
}
