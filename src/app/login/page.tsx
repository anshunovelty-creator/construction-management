import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { getProfile } from '@/lib/auth';
import { LOGIN_FIELDS } from '@/lib/masters/registry';
import { signIn } from './actions';

export default async function LoginPage() {
  if (await getProfile()) redirect('/');
  const t = await getTranslations();
  return (
    <main className="login">
      <div className="card login-card">
        <p className="brand">
          <span className="brand-mark" aria-hidden="true">₹</span>
          {t('app.name')}
        </p>
        <h1>{t('login.title')}</h1>
        <p className="lede">{t('login.lede')}</p>
        <Form fields={LOGIN_FIELDS} action={signIn} submitLabel={t('login.submit')} passwordAutoComplete="current-password" />
      </div>
    </main>
  );
}
