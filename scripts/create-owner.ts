// Creates the first owner login. Every other user is created by the owner in the app.
import { createAdminClient } from '@/lib/supabase/admin';

const [email, fullName] = process.argv.slice(2);
const password = process.env.OWNER_PASSWORD;
if (!email || !fullName || !password || password.length < 8) {
  console.error('usage: read -rs OWNER_PASSWORD && export OWNER_PASSWORD && npm run create-owner -- owner@example.com "Full Name"');
  console.error('(the password must be at least 8 characters)');
  process.exit(1);
}

const db = createAdminClient();
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) throw new Error(`could not create the login: ${error?.message}`);
const { error: profileError } = await db
  .from('profiles')
  .insert({ user_id: data.user.id, email: email.toLowerCase(), full_name: fullName, role: 'owner' });
if (profileError) {
  await db.auth.admin.deleteUser(data.user.id);
  throw new Error(`could not create the owner profile: ${profileError.message}`);
}
console.log(`Owner account created for ${email}. Start the app and sign in at /login.`);
