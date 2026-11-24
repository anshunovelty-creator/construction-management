import { notFound, redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** Everyone is in a family now (a single worker heads a family of one): a worker's ledger is their family's page. */
export default async function LabourWorkerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await (await createClient()).from('labour_workers').select('head_id').eq('id', id).maybeSingle();
  if (!data) notFound();
  redirect(`/labour/family/${data.head_id}`);
}
