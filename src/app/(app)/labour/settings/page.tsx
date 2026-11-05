import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { saveSettings } from '../actions';
import { loadSettings, showMonth } from '../data';

const percent = (bp: number) => bp / 100;

/** The PF, ESIC and OT rates, each set counting from a month, so a change leaves earlier months as they were. */
export default async function LabourSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const q = await searchParams;
  const settings = await loadSettings(await createClient());
  const now = settings.at(-1)!;
  const mayChange = profile.role !== 'labour';

  return (
    <>
      <h1>{t('labour.settingsTitle')}</h1>
      <p className="lede">{t('labour.settingsLede')}</p>
      {q.saved && <p role="status" className="banner">{t('labour.settingsSaved')}</p>}
      {q.error && <p className="banner bad">{t(`labour.errors.${q.error}`)}</p>}

      {mayChange && (
        <form action={saveSettings} className="card labour-form">
          <div className="field">
            <label htmlFor="s-pf">{t('labour.pfPercent')}</label>
            <input id="s-pf" name="pf" inputMode="decimal" required defaultValue={percent(now.pf_bp)} />
          </div>
          <div className="field">
            <label htmlFor="s-ceiling">{t('labour.pfCeiling')}</label>
            <input id="s-ceiling" name="pf_ceiling" inputMode="decimal" required defaultValue={Number(now.pf_ceiling_paise) / 100} />
            <p className="hint">{t('labour.pfCeilingHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="s-esic">{t('labour.esicPercent')}</label>
            <input id="s-esic" name="esic" inputMode="decimal" required defaultValue={percent(now.esic_bp)} />
          </div>
          <div className="field">
            <label htmlFor="s-limit">{t('labour.esicLimit')}</label>
            <input id="s-limit" name="esic_limit" inputMode="decimal" required defaultValue={Number(now.esic_limit_paise) / 100} />
            <p className="hint">{t('labour.esicLimitHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="s-ot">{t('labour.otPercent')}</label>
            <input id="s-ot" name="ot_percent" inputMode="numeric" required defaultValue={now.ot_percent} />
            <p className="hint">{t('labour.otPercentHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="s-from">{t('labour.rateFrom')}</label>
            <input id="s-from" type="month" name="from_month" required defaultValue={todayInIndia().slice(0, 7)} />
            <p className="hint">{t('labour.settingsFromHint')}</p>
          </div>
          <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
        </form>
      )}

      <h2>{t('labour.settingsHistory')}</h2>
      <div className="card table-wrap flush">
        <table className="ledger">
          <thead>
            <tr>
              <th>{t('labour.rateFrom')}</th>
              <th className="num">{t('labour.pfPercent')}</th>
              <th className="num">{t('labour.pfCeiling')}</th>
              <th className="num">{t('labour.esicPercent')}</th>
              <th className="num">{t('labour.esicLimit')}</th>
              <th className="num">{t('labour.otPercent')}</th>
            </tr>
          </thead>
          <tbody>
            {[...settings].reverse().map((s, i, all) => (
              <tr key={s.id}>
                <td>{i === all.length - 1 ? t('labour.fromStart') : showMonth(s.from_month.slice(0, 7))}</td>
                <td className="num">{percent(s.pf_bp)}%</td>
                <td className="num">{showPaise(Number(s.pf_ceiling_paise))}</td>
                <td className="num">{percent(s.esic_bp)}%</td>
                <td className="num">{showPaise(Number(s.esic_limit_paise))}</td>
                <td className="num">{s.ot_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
