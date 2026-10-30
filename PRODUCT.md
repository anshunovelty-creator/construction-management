# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Owner** (Anshu Pal): runs two construction firms, AB Infra and Jayraj Infra, across client sites. Uses both a laptop and an Android phone. Wants to know at any moment where every rupee sits.
- **Office staff**: mainly on a computer; type vendor bills, payments, client bills and receipts.
- **Site supervisors**: Android phone at the site, often outdoors in bright sun; report material used and work done per day, see their own cash.

Office and site use are roughly equal (owner answer, 2026-10-30).

## Product Purpose
A management ledger so that no rupee goes unaccounted for: every money event is recorded once, tied to a firm, a site and a party, and every balance (owed to vendors, owed by clients, cash in hand, site profit, GST, TDS, stock) is calculated from those records.

## Positioning
Built around the owner's own books: the vendor outstanding workbooks and the daily site work report. Item-wise bills with GST and TDS like Tally, but with site profit across both firms, supervisor daily reports and an append-only ledger nobody can quietly edit.

## Operating Context
- Indian construction contracting; amounts in rupees with Indian digit grouping (₹61,99,578), paise exact.
- The working firm is chosen at the top right and every screen follows it.
- Source documents: `AB_Infra_Outstanding.xlsx`, `Jayraj_Infra_Outstanding.xlsx`, `SVG SITE WORK REPORT (18-10-2026)1.pdf`.
- Installable web app (PWA) on Android; deployed on Vercel.

## Capabilities and Constraints
- Next.js + TypeScript, Tailwind v4, Supabase Postgres. Ledger tables are append-only.
- English only (owner decision 2026-10-28).
- Roles: owner, office, supervisor. Supervisors never see firm totals.
- Bill photos deferred.

## Brand Commitments
- Name in the app: "Construction Ledger"; firms: AB Infra, Jayraj Infra.
- Plain, everyday wording, no accounting jargon on screen.
- Owner explicitly allowed the visual look to be redone freely (2026-10-30). A "premium" result must not look plain or form-like.

## Evidence on Hand
Real data lives in the owner's Supabase project; no testimonials, customers or marketing claims exist and none may be invented.

## Product Principles
1. Every rupee traceable to an entry; nothing silently changed.
2. Numbers first: amounts must be easy to read, aligned and unmistakable.
3. The working firm is always in sight so nobody types into the wrong books.
4. One-thumb use on a phone at the site; a full desk on a laptop.

## Accessibility & Inclusion
Readable outdoors on budget Android phones: high contrast, 16px inputs, 44px touch targets.
