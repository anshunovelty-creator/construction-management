import { useTranslations } from 'next-intl';
import { showPaise } from '@/lib/money';

/** The choices of a "Paid from" list: banks under Bank, the firm's cash under Cash. */
export function AccountOptions({ accounts }: { accounts: { id: string; name: string; kind: string; balance?: number }[] }) {
  const t = useTranslations('cash');
  const group = (bank: boolean) => {
    const of = accounts.filter((a) => (a.kind === 'bank') === bank);
    return of.length > 0 && (
      <optgroup label={t(bank ? 'bank' : 'cash')}>
        {of.map((a) => <option key={a.id} value={a.id}>{a.name}{a.balance !== undefined && ` · ${showPaise(a.balance)}`}</option>)}
      </optgroup>
    );
  };
  return <>{group(true)}{group(false)}</>;
}
