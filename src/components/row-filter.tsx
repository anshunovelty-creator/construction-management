'use client';

import { useState } from 'react';

/** A search box that hides the rows of table #`table` whose data-name does not contain the typed text. */
export function RowFilter({ table, label, placeholder, none }: { table: string; label: string; placeholder: string; none: string }) {
  const [empty, setEmpty] = useState(false);
  function filter(text: string) {
    const want = text.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll<HTMLTableRowElement>(`#${table} tbody tr[data-name]`).forEach((row) => {
      row.hidden = !row.dataset.name!.toLowerCase().includes(want);
      if (!row.hidden) shown++;
    });
    setEmpty(shown === 0);
  }
  return (
    <div className="row-filter">
      <input type="search" aria-label={label} placeholder={placeholder} onChange={(e) => filter(e.target.value)} />
      {empty && <p className="muted" role="status">{none}</p>}
    </div>
  );
}
