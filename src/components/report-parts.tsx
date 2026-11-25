'use client';

import { useState } from 'react';

/**
 * The daily report's parts. On a phone one is shown at a time, picked from a strip that stays in sight; on a wider screen
 * they all follow each other and the strip is not there. Every part stays on the page, so nothing typed is lost.
 */
export function ReportParts({ label, parts }: { label: string; parts: { key: string; name: string; done: boolean; panel: React.ReactNode }[] }) {
  const [open, setOpen] = useState(parts[0]!.key);
  return (
    <div className="report-parts">
      <nav className="part-strip" aria-label={label}>
        {parts.map((p) => (
          <button key={p.key} type="button" className={p.key === open ? 'on' : undefined} aria-pressed={p.key === open}
            onClick={(e) => {
              setOpen(p.key);
              e.currentTarget.closest('.report-parts')?.scrollIntoView({ block: 'start' });
            }}>
            {p.name}{p.done && <span className="part-done" aria-hidden="true">✓</span>}
          </button>
        ))}
      </nav>
      {parts.map((p) => <div key={p.key} className={p.key === open ? 'part on' : 'part'}>{p.panel}</div>)}
    </div>
  );
}
