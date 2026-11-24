import { redirect } from 'next/navigation';

/** Families are listed on the Workers tab now: a single worker is a family of one. */
export default function FamiliesPage() {
  redirect('/labour');
}
