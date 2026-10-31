'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { Choice } from '@/lib/masters/registry';

/** Long lists draw only the first matches; typing narrows them. */
// ponytail: a plain filter over every choice, fine for a few thousand; move to a server search if lists outgrow that.
const SHOWN = 80;

export interface SearchSelectProps {
  options: Choice[];
  /** Given: the value is sent with the form under this name, like a <select>'s. */
  name?: string;
  /** Controlled use, with onChange. Leave out for a form field that starts at defaultValue. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** A first choice with no value, such as "All sites". Without one, clearing the box clears the value. */
  emptyLabel?: string;
  /** Submit the form as soon as something is picked (filter bars with no Show button). */
  submitOnPick?: boolean;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  title?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'data-cell'?: string;
}

const norm = (s: string) => s.toLocaleLowerCase('en-IN').normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * A dropdown you can type into: the list narrows to the choices whose name (or group) has every word typed.
 * Arrow keys move, Enter or a tap picks, Escape puts the box back. Works inside forms like a <select>.
 */
export function SearchSelect(props: SearchSelectProps) {
  const { options, name, onChange, emptyLabel, submitOnPick, required, disabled } = props;
  const t = useTranslations('search');
  const [own, setOwn] = useState(props.defaultValue ?? '');
  const value = props.value ?? own;
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? '';
  const [text, setText] = useState(() => labelOf(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pointer = useRef('');
  const listId = useId();

  // A value changed from outside (a pasted cell, a reset row) shows its name.
  useEffect(() => {
    if (!open) setText(labelOf(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options]);

  const choices = useMemo(() => {
    const words = typed ? norm(text).split(/\s+/).filter(Boolean) : [];
    const all = [...(emptyLabel ? [{ value: '', label: emptyLabel }] : []), ...options];
    return words.length === 0 ? all : all.filter((o) => {
      const hay = norm(`${o.label} ${o.group ?? ''}`);
      return words.every((w) => hay.includes(w));
    });
  }, [options, emptyLabel, text, typed]);
  const shown = choices.slice(0, SHOWN);

  // The list floats above everything (fixed), so a table's scroll box cannot cut it off.
  const place = () => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 280 > window.innerHeight && r.top > window.innerHeight - r.bottom;
    setBox({ left: r.left, top: up ? r.top : r.bottom, width: r.width, up });
  };
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open, box]);

  function show() {
    if (disabled) return;
    setActive(Math.max(choices.findIndex((o) => o.value === value), 0));
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setTyped(false);
    setText(labelOf(value));
  }
  function pick(choice: Choice) {
    setOpen(false);
    setTyped(false);
    setText(choice.value ? choice.label : '');
    if (props.value === undefined) setOwn(choice.value);
    if (hidden.current) hidden.current.value = choice.value;
    if (choice.value !== value) {
      onChange?.(choice.value);
      if (submitOnPick) input.current?.form?.requestSubmit();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open && e.key === 'ArrowUp') return;
      e.preventDefault();
      e.stopPropagation();
      if (!open) return show();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => Math.min(Math.max(a + step, 0), shown.length - 1));
    } else if (e.key === 'Enter' && open) {
      // Enter never sends the form with a half-typed name.
      e.preventDefault();
      e.stopPropagation();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function onBlur() {
    if (!open) return;
    // Leaving the box after typing takes the highlighted match; an emptied box clears an optional value.
    if (typed && text.trim() === '' && !required) pick({ value: '', label: '' });
    else if (typed && text.trim() !== '' && shown[active]) pick(shown[active]);
    else close();
  }

  return (
    <span className={`search-select${props.className ? ` ${props.className}` : ''}`}>
      <input
        ref={input}
        id={props.id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        aria-label={props['aria-label']}
        aria-invalid={props['aria-invalid']}
        aria-describedby={props['aria-describedby']}
        data-cell={props['data-cell']}
        title={props.title}
        value={text}
        placeholder={props.placeholder ?? emptyLabel ?? t('placeholder')}
        required={required}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => {
          pointer.current = `${e.clientX},${e.clientY}`;
          if (!open) show();
        }}
        onChange={(e) => {
          // Typing is not a choice yet: keep it from forms that react to every change.
          e.stopPropagation();
          setText(e.target.value);
          setTyped(true);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {name && <input ref={hidden} type="hidden" name={name} value={value} />}
      {open && box && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          className="search-list"
          style={{ left: box.left, width: Math.max(box.width, 220), ...(box.up ? { bottom: window.innerHeight - box.top } : { top: box.top }) }}
          // Keep the box focused while the list is pressed, so blur does not close it first.
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.length === 0 && <li className="search-none">{t('none')}</li>}
          {shown.map((o, i) => (
            <li
              key={o.value || '-'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={o.value === value ? 'current' : undefined}
              onMouseMove={(e) => {
                // Rows sliding under a still pointer (the list redrawn while typing) are not a hover.
                const at = `${e.clientX},${e.clientY}`;
                if (at === pointer.current) return;
                pointer.current = at;
                setActive(i);
              }}
              onClick={() => pick(o)}
            >
              <span>{o.label}</span>
              {o.group && <span className="search-group">{o.group}</span>}
            </li>
          ))}
          {choices.length > SHOWN && <li className="search-none">{t('more', { count: choices.length - SHOWN })}</li>}
        </ul>
      )}
    </span>
  );
}
