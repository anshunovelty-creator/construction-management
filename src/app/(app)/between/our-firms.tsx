import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { sameName } from '@/lib/delete';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';
import { loadDues, loadFirms } from './data';

/**
 * Our other firms on the Parties and Clients pages, with what the working firm owes each or is owed by it. One running
 * account per pair, so it is said once and kept out of the parties' and clients' own totals.
 */
export async function OurFirms({ db, firm }: { db: Awaited<ReturnType<typeof createClient>>; firm: { id: string; name: string } }) {
  const [t, firms, dues, { data: kept }] = await Promise.all([
    getTranslations(), loadFirms(db), loadDues(db),
    db.from('parties').select('id, name').in('kind', ['vendor', 'client']).eq('is_active', true),
  ]);
  const others = firms.filter((f) => f.id !== firm.id);
  if (others.length === 0) return null;
  // A firm kept as a party too would be counted outside the account between firms.
  const twice = (kept ?? []).filter((p) => firms.some((f) => sameName(f.name, p.name)));
  return (
    <section className="our-firms">
      {twice.map((p) => (
        <p key={p.id} className="banner bad">
          <span>{t('between.twice', { name: p.name })} <Link href={`/masters/parties/${p.id}`} className="underline">{t('between.openParty')}</Link></span>
        </p>
      ))}
      <div className="card table-wrap flush">
        <table className="ledger clickable">
          <thead><tr><th>{t('between.ourFirms')}</th><th className="num">{t('party.balance')}</th><th className="num">{t('client.balance')}</th></tr></thead>
          <tbody>
            {others.map((o) => {
              const due = dues.get(`${firm.id}/${o.id}`) ?? 0;
              return (
                <tr key={o.id}>
                  <td><ListLink href={`/between/${o.id}`} className="party-link">{o.name}</ListLink></td>
                  <td className={`num strong${due < 0 ? ' minus' : ' muted'}`}>{due < 0 ? showPaise(-due) : '–'}</td>
                  <td className={`num strong${due > 0 ? ' plus' : ' muted'}`}>{due > 0 ? showPaise(due) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
