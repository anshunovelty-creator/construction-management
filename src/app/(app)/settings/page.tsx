import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { LANGUAGE_FIELDS } from '@/lib/masters/registry';
import { setLanguage } from './actions';

export default async function SettingsPage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <h1>{t('settings.title')}</h1>
      <Form fields={LANGUAGE_FIELDS} defaults={{ language: profile.language }} action={setLanguage} submitLabel={t('settings.save')} />
    </>
  );
}
