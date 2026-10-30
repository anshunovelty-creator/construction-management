# Design

The app's visual system (redesign 2026-10-30). Owner's choice: a clean business-app look at the level of
Zoho Books and Stripe, light, one blue accent, nothing themed. Tokens live in `src/app/globals.css` (`:root`).

## Frame
- **Wide screens (>960px):** fixed left sidebar (248px): brand, the daily screens, a "Tools" group, Setup at the foot.
  A sticky top strip on the right holds the working firm and the account menu.
- **Phones:** top strip (₹ mark, firm, account) and a bottom tab bar with four daily screens plus **More**,
  which raises the full sidebar as a bottom sheet. Pop-ups (`.quick-dialog`) open as bottom sheets.
- `NavMenu` (`src/components/nav-menu.tsx`) renders the sidebar and tab bar; `NavLink` takes `className="tab-item"` in the bar.

## Colour
| Token | Light | Job |
|---|---|---|
| `--paper` | #f5f6f8 | page ground |
| `--sheet` | #ffffff | cards, tables, inputs |
| `--ink` / `--ink-2` / `--muted` / `--faint` | #111827 / #344054 / #5b6475 / #8a93a5 | text steps |
| `--rule` / `--rule-strong` | #e7e9ee / #d3d8e0 | hairlines, input borders |
| `--accent` | #3a56d4 | primary buttons, current page, focus, selected tab |
| `--plus` | #0b7a4e | money paid / coming to us, "Cleared" |
| `--minus` | #c4321f | money we owe, errors, "Pending" |
| `--amber` on `--mark` | #965a00 on #fff6e3 | part paid, waiting to be checked |

Dark mode mirrors every token (`prefers-color-scheme` and `data-theme`). Colour carries meaning only; no gradients
except the avatar and the sign-in page's soft wash.

## Type
Inter (Google Fonts, optical size axis), one family for everything. Fixed rem scale: h1 26px/650, h2 17px/600,
body 15px, labels 13–14px. Every number uses tabular figures (`.num`, `.amount`, stat values) so rupee columns line up.

## Components
- **Buttons:** `.btn` blue fill; `.btn.ghost` white with a line; `.btn.navy` ink fill for "Add bill"; `.btn.danger`
  white with red text. 40px tall (44 for `.big`), 8px radius.
- **Inputs:** 44px, 8px radius, custom select chevron, blue focus ring.
- **Cards:** white, 1px hairline, 12px radius, soft offset shadow (`--shadow-sm`).
- **Tables:** grey header row in sentence case, hairline between rows only, blue-tinted row hover, bold footer.
- **Tabs:** underline in blue with a count pill. **Chips / sub-nav:** pills; the chosen one is blue-tinted.
- **Status pills:** soft fill with a dot.
- **Icons:** `src/components/icons.tsx`, 24px grid, 1.75 stroke, Lucide-style line icons. No emoji or Unicode glyphs as icons.

## Rules
- No eyebrow/kicker labels above headings; section headings use `.section-title`.
- Motion 150–280ms, ease-out, state changes only; all of it off under `prefers-reduced-motion`.
- Touch targets ≥44px on phones; inputs 16px so Android does not zoom.
