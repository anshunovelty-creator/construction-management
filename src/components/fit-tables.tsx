'use client';

import { useEffect } from 'react';

const WRAP = '.table-wrap, .overflow-x-auto';
/** A read-only table only a little too wide is drawn this much smaller at most, and stays a table. */
const SMALLEST = 0.9;

/** Says each cell's column name on the cell itself, for when the headings are not shown. */
function label(table: HTMLTableElement) {
  const heads = [...(table.tHead?.rows[table.tHead.rows.length - 1]?.cells ?? [])];
  const names = heads.flatMap((th) => Array.from({ length: th.colSpan }, () => (th.textContent ?? '').replace(/\s*\*\s*$/, '').trim()));
  for (const row of [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])].flatMap((part) => [...part.rows])) {
    let col = 0;
    let titled: boolean = false;
    // A row being typed into keeps every place, so nothing jumps as its figures work themselves out.
    const form = Boolean(row.querySelector('input:not([type="hidden"]), select'));
    for (const cell of row.cells) {
      const name = cell.colSpan > 1 ? '' : (names[col] ?? '');
      const typed = Boolean(cell.querySelector('input:not([type="hidden"]), select, button, textarea'));
      const blank = !typed && !cell.querySelector('img, svg, a') && /^[–—-]?$/.test((cell.textContent ?? '').trim());
      const serial = col === 0 && /^(sr\.?|#)$/i.test(name) && !cell.classList.contains('rownum');
      const title: boolean = !titled && !blank && !serial && !typed;
      titled ||= title;
      col += cell.colSpan;
      // A serial number says nothing on a card; neither does an empty cell.
      cell.dataset.th = title ? '' : name;
      cell.toggleAttribute('data-title', title);
      cell.toggleAttribute('data-blank', (blank && !form) || serial);
    }
  }
}

/** A page still waking up must match what the server sent, so its tables are left alone until React has taken them. */
const awake = (el: Element) => Object.keys(el).some((key) => key.startsWith('__reactFiber'));

function fit(wrap: HTMLElement, resized: boolean, tries = 0) {
  const table = wrap.querySelector<HTMLTableElement>(':scope > table');
  if (!table || wrap.clientWidth === 0) return;
  // ponytail: looks at a mark React keeps on its elements; without it the table is fitted after a second anyway.
  if (!awake(table) && tries < 60) return void requestAnimationFrame(() => wrap.isConnected && fit(wrap, resized, tries + 1));
  // New rows in a table already shown as cards only need their names; measuring again could move the page under the reader.
  if (!resized && table.dataset.fit === 'cards') return label(table);
  // Never change shape under someone typing.
  if (!resized && table.contains(document.activeElement)) return;
  const y = window.scrollY;
  delete table.dataset.fit;
  // With columns of a set width the table itself always fits; what is in a cell may not.
  const set = getComputedStyle(table).tableLayout === 'fixed';
  const over = () => wrap.scrollWidth > wrap.clientWidth + 1
    || (set && [...table.rows].some((row) => [...row.cells].some((cell) => cell.scrollWidth > cell.clientWidth + 2)));
  if (over()) {
    // A search box's list is placed on the screen, so a table with boxes is never drawn smaller.
    const scale = Math.floor((wrap.clientWidth / wrap.scrollWidth) * 100) / 100;
    if (scale >= SMALLEST && window.innerWidth > 640 && !table.querySelector('input, select')) {
      table.style.setProperty('--fit', String(scale));
      table.dataset.fit = 'small';
    }
    if (over()) {
      label(table);
      table.dataset.fit = 'cards';
    }
  }
  if (window.scrollY !== y) window.scrollTo(0, y);
}

/**
 * No table ever scrolls sideways: one that does not fit where it is, on any screen and with any figures in it, is drawn
 * a little smaller or shown as a card per row (globals.css, "Tables that do not fit").
 */
export function FitTables() {
  useEffect(() => {
    const widths = new WeakMap<Element, number>();
    const sizes = new ResizeObserver((changes) => {
      for (const { target } of changes) {
        const width = (target as HTMLElement).clientWidth;
        if (widths.get(target) === width) continue;
        widths.set(target, width);
        fit(target as HTMLElement, true);
      }
    });
    const watch = (wrap: Element) => sizes.observe(wrap);
    document.querySelectorAll(WRAP).forEach(watch);
    const changes = new MutationObserver((records) => {
      const touched = new Set<HTMLElement>();
      for (const { target, addedNodes } of records) {
        const wrap = (target instanceof Element ? target : target.parentElement)?.closest<HTMLElement>(WRAP);
        if (wrap) touched.add(wrap);
        for (const node of addedNodes) if (node instanceof Element) {
          if (node.matches(WRAP)) touched.add(node as HTMLElement);
          node.querySelectorAll<HTMLElement>(WRAP).forEach((w) => touched.add(w));
        }
      }
      for (const wrap of touched) {
        watch(wrap);
        fit(wrap, false);
      }
    });
    changes.observe(document.body, { childList: true, characterData: true, subtree: true });
    // Letters take their final width when the font arrives.
    document.fonts?.ready.then(() => document.querySelectorAll<HTMLElement>(WRAP).forEach((wrap) => fit(wrap, true)));
    return () => { sizes.disconnect(); changes.disconnect(); };
  }, []);
  return null;
}
