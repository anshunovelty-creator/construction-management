'use client';

import Form from 'next/form';
import { Fragment, useRef, useState } from 'react';
import { mayLeave } from '@/components/unsaved';

/**
 * A search form that opens what was picked as soon as it changes, so there is no Open button. A typed date waits a
 * moment, so typing it digit by digit opens it only once it is a whole, allowed date. (A SearchSelect opens on pick.)
 */
export function AutoForm({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Staying, because something typed is not saved yet, puts the boxes back to what the page shows.
  const [stayed, setStayed] = useState(0);
  return (
    <Form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (mayLeave()) return;
        e.preventDefault();
        setStayed((n) => n + 1);
      }}
      onChange={(e) => {
        const form = e.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => form.checkValidity() && form.requestSubmit(), 500);
      }}
    >
      <Fragment key={stayed}>{children}</Fragment>
    </Form>
  );
}
