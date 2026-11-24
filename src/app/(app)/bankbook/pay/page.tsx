import { PayListPage } from '../pay-list-page';

/** Pay: everyone the working firm has to pay. ?account= is the account it was opened from. */
export default async function Page({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  return <PayListPage side="party" account={(await searchParams).account} />;
}
