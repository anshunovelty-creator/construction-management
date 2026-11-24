import { getTranslations } from 'next-intl/server';
import { AccountOptions } from '@/components/account-options';
import { RupeesInput } from '@/components/form';
import { payTax } from '@/app/(app)/pay/tax';
import { showPaise } from '@/lib/money';

/** Tax paid to the government for a month, from one of the firm's accounts. */
export async function TaxPaid({ reason, month, left, accounts, today, back }: {
  reason: 'gst_paid' | 'tds_paid' | 'pf_paid';
  month: string;
  left: number;
  accounts: { id: string; name: string; kind: string; balance: number }[];
  today: string;
  back: string;
}) {
  const t = await getTranslations();
  return (
    <details className="tax-paid no-print">
      <summary className="btn">{t(`tax.button.${reason}`)}</summary>
      <form action={payTax.bind(null, reason, back)} className="card labour-form">
        <div className="field"><label htmlFor={`${reason}-month`}>{t('tax.month')}</label><input id={`${reason}-month`} type="month" name="month" required defaultValue={month} max={today.slice(0, 7)} /></div>
        <div className="field"><label htmlFor={`${reason}-amount`}>{t('labour.amount')}</label><RupeesInput input={{ id: `${reason}-amount`, name: 'amount', required: true, defaultValue: left > 0 ? String(left / 100) : '' }} /></div>
        <div className="field"><label htmlFor={`${reason}-account`}>{t('pay.from')}</label>
          <select id={`${reason}-account`} name="account" required defaultValue=""><option value="">{t('bankbook.popup.pick')}</option>
            <AccountOptions accounts={accounts} /></select></div>
        <div className="field"><label htmlFor={`${reason}-date`}>{t('fields.entry_date')}</label><input id={`${reason}-date`} type="date" name="date" required defaultValue={today} max={today} /></div>
        <div className="field"><label htmlFor={`${reason}-ref`}>{t('tax.challan')}</label><input id={`${reason}-ref`} name="reference" /></div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
      </form>
    </details>
  );
}
