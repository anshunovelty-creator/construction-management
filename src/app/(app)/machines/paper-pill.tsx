import type { getTranslations } from 'next-intl/server';
import { daysLeft, paperState } from '@/lib/machines';
import { showDate } from '../entries/data';

type T = Awaited<ReturnType<typeof getTranslations>>;
const TONE = { none: 'reversal', ok: 'cleared', soon: 'unverified', out: 'pending' } as const;

/** A paper's state at a glance: green while valid, amber in its last 30 days, red once it has run out. */
export function PaperPill({ until, today, t }: { until: string | undefined; today: string; t: T }) {
  const state = paperState(until, today);
  return (
    <span className={`pill ${TONE[state]}`}>
      {state === 'none' ? t('machines.papers.missing') : t(`machines.papers.${state}`, { date: showDate(until!), days: daysLeft(until!, today) })}
    </span>
  );
}
