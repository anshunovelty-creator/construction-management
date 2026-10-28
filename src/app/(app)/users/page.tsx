import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { ListLink } from '@/components/list-link';
import { requireProfile, type Profile } from '@/lib/auth';
import { NEW_USER_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../masters/options';
import { createUser } from './actions';

export default async function UsersPage() {
  await requireProfile('owner');
  const db = await createClient();
  const [{ data: users }, choices, t] = await Promise.all([
    db.from('profiles').select('*').order('full_name').returns<Profile[]>(),
    loadChoices(db, NEW_USER_FIELDS),
    getTranslations(),
  ]);

  return (
    <>
      <h1>{t('users.title')}</h1>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>{t('fields.full_name')}</th>
              <th>{t('fields.email')}</th>
              <th>{t('fields.role')}</th>
              <th>{t('fields.is_active')}</th>
              <th aria-label={t('masters.edit')} />
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((user) => (
              <tr key={user.user_id}>
                <td>{user.full_name}</td>
                <td>{user.email}</td>
                <td>{t(`options.role.${user.role}`)}</td>
                <td>{t(user.is_active ? 'common.yes' : 'common.no')}</td>
                <td>
                  <ListLink href={`/users/${user.user_id}`} className="underline">
                    {t('masters.edit')}
                  </ListLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>{t('users.add')}</h2>
      <Form fields={NEW_USER_FIELDS} choices={choices} action={createUser} submitLabel={t('users.add')} />
    </>
  );
}
