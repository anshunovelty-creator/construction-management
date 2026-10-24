'use client';

import Form from 'next/form';

/** A filter form with no Show button: picking a firm, site or date loads the results right away. */
export function AutoForm({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  return (
    <Form action={action} className={className} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
    </Form>
  );
}
