# Firm Switcher: Design Spec

**Date:** 2026-10-25
**Status:** Draft for owner review
**Builds on:** `2026-10-22-construction-ledger-design.md` (nothing approved there changes)

## 1. Purpose

The owner runs two firms, AB Infra and Jayraj Infra. Today each screen has its own firm chips, and the vendor bill and pay vendor forms ask for the firm on every entry. People should instead pick a **working firm** once, with a button at the top right, and then work inside that firm: every screen shows only its numbers, and every new entry is made for it. Switching needs no password.

## 2. Decisions (owner, 2026-10-25)

| Question | Decision |
|---|---|
| What a switch changes | **Working firm.** Screens show only that firm; new entries are made for it; forms no longer ask for the firm. Shared things stay shared, as approved: one vendor list, sites, owner cash and supervisor cash. |
| A combined view | **Not in the switcher.** Dashboard, report and analysis pages will offer three choices each (AB Infra, Jayraj Infra, Combined), and open on the working firm. Built with those pages, not here. |
| The other firm's bank in money lists | **Shown, in a separate group** labelled with the due it creates, e.g. "Other firm: AB will owe Jayraj". |
| Where the choice is kept | **On the person's account,** so it follows them to every device. |

## 3. What people see

### 3.1 The switcher

- A button at the right of the top bar shows the working firm, e.g. **AB Infra ▾**. Tapping it lists the person's firms; tapping one switches and reloads the current page in that firm.
- **Owner:** both firms. **Office staff:** their assigned firms. With only one firm, the bar shows its name and no menu. **Supervisors:** no button and no working firm; their screens don't change.

### 3.2 Screens that follow the working firm

| Screen | Change |
|---|---|
| Parties (`/`), Clients, Dashboard (today's party summary) | Show the working firm. The `FirmTabs` chips are removed. |
| Party page, client page | Show the chosen party for the working firm. Links carry only the party: `/party?id=`, `/client?id=`. |
| Day book (`/entries`) | Shows the working firm's entries (any entry with a line for that firm) **plus Common entries**: those with no firm on any line, such as owner cash to supervisor cash, a supervisor's site spend, or a day close. Common entries carry a **Common** tag. The firm dropdown is removed; the date, site and "not yet checked" filters stay. |
| Entry sheet | No firm column; every row is for the working firm. |
| Overview (More menu) | Stays a whole-books board until the three-way reports are built. Its per-firm day book links are removed, since the day book now follows the switcher. |

**Not changed:** a single entry's page (`/entries/<id>`) shows any entry the person may see, whatever the working firm. Masters, Users, History and Settings are shared and don't change.

An old link that names a firm (`?firm=…`) opens in the working firm; the parameter is ignored.

### 3.3 Entry forms

The firm box is removed. Forms for a firm's vendor or client (vendor bill, pay vendor, client bill, client receipt) say **"For AB Infra"** at the top. Forms whose firm comes from the money account (move money, site spend, day close, owner money) say **"Working in AB Infra"**: as now, a bank makes the entry that bank's firm's, and cash makes it Common.

As approved, an entry's serial number still comes from the account the money moved through, so a payment from owner cash keeps its `CM/…` serial.

Below, W is the working firm and O the other firm.

| Form | Made for | Money account lists |
|---|---|---|
| Vendor bill | W's vendor | — |
| Pay vendor | W's vendor | **Paid from:** W's banks and common cash, then O's banks under "Other firm: W will owe O" |
| Client bill | W's work order (list narrowed to W's) | — |
| Client receipt | W's work order (list narrowed to W's) | **Received into:** W's banks and common cash, then O's banks under "Other firm: O will owe W" |
| Move money | The from-account's firm, as now | **From:** W's banks and common cash. **To:** W's banks and common cash, then O's banks under "Other firm: O will owe W". A move out of O's bank is made while working in O. |
| Site spend (owner) | The account's firm, as now | **From:** W's banks and common cash |
| Day close (owner) | The account's firm, as now | **Account:** W's banks and common cash |
| Owner money | The account's firm, as now | **Account:** W's banks and common cash |

Supervisors' forms (site spend, day close) don't change: they list the supervisor's own cash accounts, as now.

The between-firm dues come from the posting rules that already exist (`interFirmLines`); nothing new is written to the ledger.

## 4. How it's stored and checked

### 4.1 Database

- **New table `working_firms`:** `user_id` (primary key, references `profiles`), `firm_id` (references `firms`), `updated_at`. One row per person.
- It is deliberately **not** a column on `profiles`. `profiles` has an audit trigger writing to the append-only `master_changes`, so every switch would add a permanent History line. A working firm is a preference, not master data, so the table has no audit trigger.
- **Row Level Security:** a person may read only their own row. No insert, update or delete grants.
- **New function `app_set_my_firm(p_firm_id uuid)`** (security definer): raises unless the caller is signed in, active and `app_has_firm(p_firm_id)` holds. That allows the owner any firm, office staff their assigned firms and supervisors none. Otherwise it upserts the caller's row.
- It is a new migration file in `supabase/migrations/` and touches no ledger table.

### 4.2 Reading the working firm

A server helper in `src/lib/firm.ts`, cached once per request like `getProfile`:

1. **Supervisor →** no working firm.
2. Otherwise it loads the firms the person may use, A to Z by name, and their saved row.
3. **Saved firm allowed →** that firm. **No row, or the firm is no longer allowed →** the first allowed firm. Nothing is written on fallback.
4. **No allowed firms →** no working firm, and firm screens show the existing "no firm" message (`party.noFirm`).

### 4.3 Switching

The top-bar menu is a small form posting to a server action. The action calls `app_set_my_firm` and then `revalidatePath('/', 'layout')`, so the same page reloads in the new firm. On error the firm stays as it was, and a short message is shown.

### 4.4 Saving entries

- Each form carries the working firm as a hidden value, set when the page is rendered. The entry is made for **that** firm, even if the person switched on another device or tab before pressing Save.
- **Server checks** (save actions), before posting:
  - The person may use the form's firm.
  - The work order belongs to the form's firm.
  - Every chosen money account is in that form's lists for the form's firm (section 3.3).
- The database keeps its existing checks (`app_assert_can_post`) and has the final say.

## 5. Components

| Piece | Where | What it does |
|---|---|---|
| Migration | `supabase/migrations/20261025120000_working_firm.sql` | `working_firms`, RLS, `app_set_my_firm`, grants |
| Working-firm helper | `src/lib/firm.ts` | Allowed firms and the working firm, per request (4.2) |
| Switcher and action | `src/app/(app)/layout.tsx` + a `switchFirm` server action | Top-bar button and menu (3.1, 4.3) |
| Firm pages | `page.tsx` (Parties), `clients`, `client`, `dashboard`, `party`, `entries` | Read the helper instead of `?firm=`; `FirmTabs` removed; Common tag in the day book |
| Form lists | `src/app/(app)/masters/options.ts` | Work orders narrowed to the firm; money accounts ordered and grouped per section 3.3 |
| Grouped dropdowns | `src/components/form.tsx`, `src/components/entry-sheet.tsx` | Optional `group` on a choice, shown as an `<optgroup>` |
| Entry forms | `src/lib/masters/registry.ts`, `entries/new/[slug]/page.tsx`, `entries/actions.ts` | Firm field becomes the hidden working firm; "For …" / "Working in …" heading; server checks (4.4) |
| Words | `messages/` (English and Hindi) | Switcher, "For …", "Working in …", "Other firm: …", "Common" |

## 6. Testing

Same setup as now: `npm test` on in-process PGlite, no Docker.

- **Database:**
  - The owner can switch to either firm.
  - Office staff can switch only to assigned firms.
  - Supervisors and deactivated users are refused.
  - A person can't read anyone else's row.
  - Switching adds nothing to `master_changes`.
- **Working-firm helper:**
  - Uses the saved firm when it's allowed.
  - Falls back to the first allowed firm when nothing is saved or the assignment was removed.
  - Supervisors get none.
  - Office staff with no firms get none.
- **Form lists:** work orders narrowed to the firm; own banks and common cash before the "Other firm" group, on the forms that have one (3.3).
- **Saving:**
  - A form rendered for AB Infra saves for AB Infra after the account switched to Jayraj.
  - A firm, work order or money account outside the form's lists is refused.
- **Day book:** in AB Infra it lists AB's entries and Common entries (tagged), and none of Jayraj-only entries.
- **By hand in the running app:**
  - Switch, and check every screen in 3.2 follows.
  - Make a vendor bill in each firm.
  - Pay an AB bill from Jayraj's bank, and check the between-firm due appears.

## 7. Not in this work

- The three-way (AB Infra / Jayraj Infra / Combined) dashboard, reports and analysis pages.
- Any change to how entries post, serial numbers, or the shared vendor list, sites and cash.
