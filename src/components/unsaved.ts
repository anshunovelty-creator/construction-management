'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

/** Every form on the page that may hold typing not saved yet. */
const checks = new Set<() => boolean>();
let words = '';

/** True when nothing typed would be lost, or the person says to leave anyway. */
export const mayLeave = () => ![...checks].some((unsaved) => unsaved()) || window.confirm(words);

const onUnload = (e: BeforeUnloadEvent) => {
  if ([...checks].some((unsaved) => unsaved())) e.preventDefault();
};
/** A link to another page of the app does not reload it, so the browser itself would not ask. */
const onClick = (e: MouseEvent) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!link || link.target === '_blank' || link.hasAttribute('download') || link.origin !== location.origin) return;
  if (link.pathname === location.pathname && link.search === location.search) return;
  if (mayLeave()) return;
  e.preventDefault();
  e.stopPropagation();
};
/** The back button or gesture, where the browser lets it be stopped (Chrome and Android). */
const onNavigate = (e: Event) => {
  const nav = e as Event & { navigationType?: string };
  if (nav.navigationType === 'traverse' && e.cancelable && !mayLeave()) e.preventDefault();
};

/** A phone-sized screen, as the styles have it. */
export const onPhone = () => window.matchMedia('(max-width: 640px)').matches;

const navigation = () => (window as unknown as { navigation?: EventTarget }).navigation;

/** Asks before leaving the page while `unsaved` says something typed here is not saved yet. */
export function useUnsaved(unsaved: () => boolean): void {
  const t = useTranslations('common');
  const text = t('unsaved');
  const latest = useRef(unsaved);
  useEffect(() => {
    latest.current = unsaved;
  });
  useEffect(() => {
    words = text;
    const check = () => latest.current();
    if (checks.size === 0) {
      window.addEventListener('beforeunload', onUnload);
      document.addEventListener('click', onClick, true);
      navigation()?.addEventListener('navigate', onNavigate);
    }
    checks.add(check);
    return () => {
      checks.delete(check);
      if (checks.size > 0) return;
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
      navigation()?.removeEventListener('navigate', onNavigate);
    };
  }, [text]);
}
