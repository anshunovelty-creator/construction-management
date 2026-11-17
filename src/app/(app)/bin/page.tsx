import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showMoment } from '../entries/data';
import { purgeItem, restoreItem } from './actions';
import { kindLabel } from './labels';

interface BinRow {
  id: string;
  kind: string;
  name: string;
  deleted_by: string | null;
  deleted_at: string;
}

const KEPT_DAYS = 30;

/** Recycle bin: what was deleted in the last 30 days, who deleted it, and a button to put it back. Owner only. */
export default async function BinPage({ searchParams }: { searchParams: Promise<{ restored?: string; purged?: string; error?: string }> }) {
  await requireProfile('owner');
  const [{ restored, purged, error }, t, db] = await Promise.all([searchParams, getTranslations(), createClient()]);
  const [{ data: items }, names] = await Promise.all([
    db.from('recycle_bin').select('id, kind, name, deleted_by, deleted_at').order('deleted_at', { ascending: false }).returns<BinRow[]>(),
    loadNames(db),
  ]);
  const daysLeft = (at: string) => Math.max(0, KEPT_DAYS - Math.floor((Date.now() - Date.parse(at)) / 86_400_000));

  return (
    <>
      <div className="hero">
        <div>
          <h1>{t('bin.title')}</h1>
          <p className="lede">{t('bin.lede')}</p>
        </div>
        <div className="hero-actions">
          <Link href="/bin/demo" className="btn ghost"><Icon name="trash" /> {t('bin.demo.title')}</Link>
        </div>
      </div>
      {restored && <p className="banner" role="status">{t('bin.restored', { name: restored })}</p>}
      {purged && <p className="banner" role="status">{t('bin.purged')}</p>}
      {error && <p className="banner bad" role="alert">{t(`bin.errors.${error}`)}</p>}

      {items && items.length > 0 ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('bin.name')}</th>
                <th>{t('bin.from')}</th>
                <th>{t('bin.deletedBy')}</th>
                <th className="num">{t('bin.daysLeft')}</th>
                <th aria-label={t('bin.actions')} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.name}</b></td>
                  <td>{kindLabel(t, item.kind)}</td>
                  <td className="nowrap">
                    {(item.deleted_by && names.people.get(item.deleted_by)) ?? '?'}
                    <span className="muted block">{showMoment(item.deleted_at)}</span>
                  </td>
                  <td className="num">{daysLeft(item.deleted_at)}</td>
                  <td className="nowrap">
                    <span className="bin-actions">
                      <form action={restoreItem.bind(null, item.id, item.name)}>
                        <button type="submit" className="btn small">{t('bin.restore')}</button>
                      </form>
                      <details className="cancel">
                        <summary>{t('bin.purge')}</summary>
                        <form action={purgeItem.bind(null, item.id)}>
                          <button type="submit" className="btn danger small">{t('bin.purgeConfirm', { name: item.name })}</button>
                        </form>
                      </details>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">{t('bin.empty')}</p>
      )}
    </>
  );
}
