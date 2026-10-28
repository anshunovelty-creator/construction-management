'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * A link in a long list (entries, parties, Setup rows). Its page is fetched when the pointer or a finger
 * reaches it, not as soon as it is on screen: a day book of 200 rows would otherwise send 200 requests.
 */
export function ListLink(props: React.ComponentProps<typeof Link>) {
  const router = useRouter();
  const warm = () => router.prefetch(String(props.href));
  return <Link {...props} prefetch={false} onMouseEnter={warm} onTouchStart={warm} />;
}
