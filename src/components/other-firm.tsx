import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** Shown in place of Labour payment or the AJAX machines while working in a firm they do not belong to. */
export async function OtherFirm({ firm }: { firm: string }) {
  const t = await getTranslations();
  return (
    <p className="card empty-state">
      {firm ? t('firm.belongsTo', { firm }) : <>{t('firm.noneRuns')} <Link href="/masters/firms" className="underline">{t('party.goSetup')}</Link></>}
    </p>
  );
}
