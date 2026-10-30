import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile, type Profile } from '@/lib/auth';
import { EDIT_USER_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../masters/options';
import { updateUser } from '../actions';
import { Icon } from '@/components/icons';

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile('owner');
  const db = await createClient();
  const { data: user } = await db.from('profiles').select('*').eq('user_id', id).maybeSingle<Profile>();
  if (!user) notFound();
  const [{ data: firms }, { data: sites }, choices, t] = await Promise.all([
    db.from('user_firms').select('firm_id').eq('user_id', id),
    db.from('user_sites').select('site_id').eq('user_id', id),
    loadChoices(db, EDIT_USER_FIELDS),
    getTranslations(),
  ]);
  const defaults = {
    full_name: user.full_name,
    role: user.role,
    is_active: user.is_active,
    firms: (firms ?? []).map((r) => r.firm_id as string),
    sites: (sites ?? []).map((r) => r.site_id as string),
  };

  return (
    <>
      <p className="mb-2">
        <Link href="/users" className="back">
          <Icon name="chevronLeft" size={16} /> {t('users.title')}
        </Link>
      </p>
      <h1>{user.full_name}</h1>
      <p className="mb-4 text-gray-600">
        {user.email} · {t('users.keepPassword')}
      </p>
      <Form fields={EDIT_USER_FIELDS} defaults={defaults} choices={choices} action={updateUser.bind(null, id)} submitLabel={t('masters.save')} />
    </>
  );
}
