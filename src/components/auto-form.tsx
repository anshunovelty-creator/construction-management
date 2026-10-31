'use client';

import Form from 'next/form';
import { useRef } from 'react';

/**
 * A search form that opens what was picked as soon as it changes, so there is no Open button. A pick from a list opens
 * at once; a typed date waits a moment, so typing it digit by digit opens it only once it is a whole, allowed date.
 */
export function AutoForm({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <Form
      action={action}
      className={className}
      onChange={(e) => {
        const form = e.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => form.checkValidity() && form.requestSubmit(), e.target instanceof HTMLSelectElement ? 0 : 500);
      }}
    >
      {children}
    </Form>
  );
}
