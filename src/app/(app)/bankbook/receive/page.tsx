import { PayListPage } from '../pay-list-page';

/** Receive: everyone the working firm has money to come from. ?account= is the account it was opened from. */
export default async function Page({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  return <PayListPage side="client" account={(await searchParams).account} />;
}
