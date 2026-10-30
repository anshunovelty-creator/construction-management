'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from 'react';
import { ChoiceOptions } from '@/components/choice-options';
import type { FormState } from '@/components/form';
import type { Choice } from '@/lib/masters/registry';
import { Icon } from '@/components/icons';

export interface Column {
  name: string;
  label: string;
  hint?: string;
  kind: 'text' | 'rupees' | 'date' | 'select';
  required: boolean;
  options?: Choice[];
}

type Saved = { id: string; serial: string };
interface Row {
  id: string;
  cells: Record<string, string>;
  result?: Saved | FormState;
}

/** Row and column of the sheet cell an event came from. */
function cellOf(target: EventTarget): [number, number] | null {
  const m = (target as HTMLElement).dataset?.cell?.match(/^(\d+)-(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const isSaved = (row: Row): row is Row & { result: Saved } => !!row.result && 'id' in row.result;

/** 17/10/2026, 17-10-2026 or 17.10.2026 (as Excel copies Indian dates) -> 2026-10-17. */
function toIsoDate(text: string): string {
  const [, d, mo, y] = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) ?? [];
  return d && mo && y ? `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` : text;
}

/** Finds the choice a pasted word means: its exact label, its value, or the part after "FA · ". */
function matchOption(options: Column['options'], text: string): string | undefined {
  const want = text.trim().toLowerCase();
  if (!want) return '';
  const found =
    options?.find((o) => o.value === text.trim() || o.label.toLowerCase() === want) ??
    options?.find((o) => o.label.toLowerCase().split(' · ').includes(want)) ??
    options?.find((o) => o.label.toLowerCase().startsWith(want));
  return found?.value;
}

/** An Excel-like grid: one row is one entry. Rows are saved through the same checks as the form. */
export function EntrySheet({
  columns,
  today,
  save,
  start = 5,
  defaults = {},
}: {
  columns: Column[];
  today: string;
  save: (rows: { id: string; cells: Record<string, string> }[]) => Promise<Record<string, Saved | FormState>>;
  /** How many empty rows to begin with. */
  start?: number;
  /** Values new rows begin with, e.g. the site of the party's last bill. */
  defaults?: Record<string, string>;
}) {
  const t = useTranslations();
  const blank = (): Row => ({
    id: crypto.randomUUID(),
    cells: Object.fromEntries(columns.map((c) => [c.name, c.name === 'entry_date' ? today : (defaults[c.name] ?? '')])),
  });
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: start }, blank));
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState('');

  // A row only counts as typed in once something differs from how it began.
  const filled = (row: Row) => columns.some((c) => c.name !== 'entry_date' && (row.cells[c.name] ?? '').trim() !== (defaults[c.name] ?? ''));
  // Warn before closing or refreshing the page while typed rows are not saved yet.
  const unsaved = rows.some((row) => !isSaved(row) && filled(row));
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const setCell = (r: number, name: string, value: string) =>
    setRows((all) => all.map((row, i) => (i === r ? { ...row, cells: { ...row.cells, [name]: value }, result: undefined } : row)));
  // A row added just now only exists after the next render, so wait a frame for it.
  const focusCell = (r: number, c: number) => {
    const find = () => document.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`);
    const cell = find();
    if (cell) cell.focus();
    else requestAnimationFrame(() => find()?.focus());
  };

  // Enter goes down a row (adding one at the bottom); arrows move between text boxes like Excel.
  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    const at = cellOf(e.target);
    if (!at) return;
    const [r, c] = at;
    const textBox = (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text';
    const down = e.key === 'Enter' || (textBox && e.key === 'ArrowDown');
    if (down) {
      e.preventDefault();
      if (r === rows.length - 1) setRows((all) => [...all, blank()]);
      focusCell(r + 1, c);
    } else if (textBox && e.key === 'ArrowUp' && r > 0) {
      e.preventDefault();
      focusCell(r - 1, c);
    }
  }

  // Pasting a block copied from Excel fills cells to the right and rows below, adding rows as needed.
  function onPaste(e: ClipboardEvent<HTMLTableElement>) {
    const at = cellOf(e.target);
    if (!at) return;
    const [r, c] = at;
    const grid = e.clipboardData.getData('text').replace(/\r/g, '').replace(/\n$/, '').split('\n').map((line) => line.split('\t'));
    const single = grid.length === 1 && grid[0]?.length === 1;
    const kind = columns[c]?.kind;
    if (single && kind !== 'select' && kind !== 'date') return;
    e.preventDefault();
    setRows((all) => {
      const next = [...all];
      grid.forEach((values, dr) => {
        const to = r + dr;
        while (next.length <= to) next.push(blank());
        const prev = next[to]!;
        const row: Row = { ...prev, cells: { ...prev.cells }, result: undefined };
        const errors: Record<string, string> = {};
        values.forEach((raw, dc) => {
          const col = columns[c + dc];
          if (!col) return;
          let value = raw.trim();
          if (col.kind === 'date') value = toIsoDate(value);
          if (col.kind === 'select') {
            const match = matchOption(col.options, value);
            if (match === undefined) errors[col.name] = 'invalid_choice';
            value = match ?? '';
          }
          row.cells[col.name] = value;
        });
        if (Object.keys(errors).length) row.result = { errors };
        next[to] = row;
      });
      return next;
    });
  }

  function saveAll() {
    const todo = rows.filter((row) => !isSaved(row) && filled(row));
    if (todo.length === 0) return setNotice(t('sheet.empty'));
    setNotice('');
    startTransition(async () => {
      const results = await save(todo.map(({ id, cells }) => ({ id, cells })));
      setRows((all) => all.map((row) => (results[row.id] ? { ...row, result: results[row.id] } : row)));
      const saved = todo.filter((row) => isSaved({ ...row, result: results[row.id] })).length;
      setNotice(t('sheet.summary', { saved, failed: todo.length - saved }));
    });
  }

  const message = (result: FormState) => {
    const form = result.errors?._form;
    if (form) return `${t(`errors.${form}`)}${result.detail ? ` (${result.detail})` : ''}`;
    return Object.entries(result.errors ?? {})
      .map(([name, key]) => `${columns.find((c) => c.name === name)?.label}: ${t(`errors.${key}`)}`)
      .join(' · ');
  };

  return (
    <div className="sheet-wrap">
      <div className="table-wrap">
        <table className="sheet" onKeyDown={onKeyDown} onPaste={onPaste}>
          <thead>
            <tr>
              <th className="rownum">#</th>
              {columns.map((col) => (
                <th key={col.name} title={col.hint}>
                  {col.label}
                  {col.required && <span className="req" aria-hidden="true"> *</span>}
                </th>
              ))}
              <th>{t('sheet.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const saved = isSaved(row);
              const errors = row.result && !saved ? ((row.result as FormState).errors ?? {}) : {};
              return (
                <tr key={row.id} className={saved ? 'saved' : row.result ? 'failed' : undefined}>
                  <td className="rownum">{r + 1}</td>
                  {columns.map((col, c) => {
                    const common = {
                      'data-cell': `${r}-${c}`,
                      'aria-label': `${col.label} ${r + 1}`,
                      'aria-invalid': errors[col.name] ? true : undefined,
                      title: errors[col.name] ? t(`errors.${errors[col.name]}`) : undefined,
                      disabled: saved || pending,
                      value: row.cells[col.name],
                    };
                    return (
                      <td key={col.name} className={col.kind === 'rupees' ? 'num' : undefined}>
                        {col.kind === 'select' ? (
                          <select {...common} onChange={(e) => setCell(r, col.name, e.target.value)}>
                            <option value="" />
                            <ChoiceOptions choices={col.options ?? []} />
                          </select>
                        ) : (
                          <input
                            {...common}
                            type={col.kind === 'date' ? 'date' : 'text'}
                            inputMode={col.kind === 'rupees' ? 'decimal' : undefined}
                            onChange={(e) => setCell(r, col.name, e.target.value)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="status">
                    {saved ? (
                      <Link href={`/entries/${row.result.id}`}><Icon name="check" size={14} /> {row.result.serial}</Link>
                    ) : row.result ? (
                      <span className="error">{message(row.result as FormState)}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row-buttons">
        <button type="button" className="btn" onClick={saveAll} disabled={pending}>
          {pending ? t('sheet.saving') : t('sheet.save')}
        </button>
        <button type="button" className="btn ghost" onClick={() => setRows((all) => [...all, ...Array.from({ length: 5 }, blank)])} disabled={pending}>
          {t('sheet.addRows')}
        </button>
        {rows.some(isSaved) && (
          <button type="button" className="btn ghost" onClick={() => setRows((all) => all.filter((row) => !isSaved(row)))} disabled={pending}>
            {t('sheet.clearSaved')}
          </button>
        )}
        {notice && <p className="sheet-notice" role="status">{notice}</p>}
      </div>
    </div>
  );
}
