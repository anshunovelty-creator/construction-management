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
    <main className="mx-auto max-w-sm p-6">
      <p className="mb-2 text-gray-600">{t('app.name')}</p>
      <h1>{t('login.title')}</h1>
      <Form fields={LOGIN_FIELDS} action={signIn} submitLabel={t('login.submit')} passwordAutoComplete="current-password" />
    </main>
  );
}
