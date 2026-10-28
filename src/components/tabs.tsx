'use client';

import { useId, useRef, useState } from 'react';

export interface Tab { key: string; label: string; count: number; panel: React.ReactNode }

/**
 * Tabs over a page's sections. Every panel stays on the page (only hidden), so rows typed
 * into one tab are kept when switching. The open tab is kept in ?tab= so a refresh stays put.
 */
export function Tabs({ tabs, initial }: { tabs: Tab[]; initial: string }) {
  const id = useId();
  const [open, setOpen] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0]!.key);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (key: string) => {
    setOpen(key);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    window.history.replaceState(null, '', url);
  };
  // Left and right arrows move between tabs, as screen-reader users expect.
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = (i + step + tabs.length) % tabs.length;
    pick(tabs[next]!.key);
    buttons.current[next]?.focus();
  };
  return (
    <div className="tabs">
      <div className="tab-list" role="tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => { buttons.current[i] = el; }}
            type="button"
            role="tab"
            id={`${id}-${tab.key}`}
            aria-selected={open === tab.key}
            aria-controls={`${id}-${tab.key}-panel`}
            tabIndex={open === tab.key ? 0 : -1}
            className="tab"
            onClick={() => pick(tab.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {tab.label} <span className="count">{tab.count}</span>
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" id={`${id}-${tab.key}-panel`} aria-labelledby={`${id}-${tab.key}`}
          hidden={open !== tab.key} className="tab-panel">
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
