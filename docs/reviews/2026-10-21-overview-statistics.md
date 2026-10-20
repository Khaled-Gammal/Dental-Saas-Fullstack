# Overview statistics: period, comparisons, chart (S2, 2026-10-21)

The second step of the statistics work: `GET /reports/stats` (S1, `2026-10-21-statistics-api.md`) on the overview, for
the owner and the accountant (`reports:read`), as the user chose. Reception and doctors keep their overview as it was.
On `v4/overview-redesign`, after the S1 commit.

## What changed

- **«أداء العيادة», under the header:**
  - **Period:** today, this month (default), last month, this year. These are the reports page's own presets; custom
    dates stay on the reports page.
  - **Branch:** a picker, shown when the member works at more than one branch.
  - **The comparison period** is named under the title («مقارنةً بالفترة من 1 سبتمبر إلى 21 سبتمبر»).
- **Four period cards**, each opening its report:
  - net collections (invoiced under it);
  - net income (labelled with the reports page's own words, «التحصيل ناقص المصروفات»);
  - new patients («أول زيارة لهم في هذه الفترة»);
  - appointments (attended and no-shows under it).

  Each shows how it moved against the previous period (▲/▼ and a percentage, in green or red). When the previous period
  was zero it says so («لا شيء في الفترة السابقة للمقارنة»), with no invented percentage. The percentage is display
  only (`change()` in `overview-model.ts`, tested); the two numbers are the API's.
- **Chart card («الإيرادات والمصروفات»):**
  - **The chart:** net collections and expenses per day, or per month for long periods, as the API's `bucket` says. It
    uses shadcn/ui's chart (`components/ui/chart.tsx`, recharts), at the user's request.
  - **Layout:** time runs right to left (oldest by the amounts axis, on the right); the axis shows compact Arabic
    amounts; the tooltip shows each amount formatted.
  - **Beside it, a summary:** invoiced, net collections, expenses, net income, owed by patients, overdue.
  - **Screen readers:** they get the same numbers as a table.
- **What it replaces (for owner and accountant):** the old "today and this month" money table and the today cards. The
  period section covers the same figures for any period. Today's remaining appointments and «يحتاج انتباهك» stay
  below, unchanged.
- **Loading and errors:** skeleton cards while loading; an error card with retry.
- **Requests:** the branch list and the statistics are asked only for members with `reports:read`. The existing report
  hooks gained optional `enabled` flags.

## The dependency

- **What was added:** `recharts` 3.8.0, exact version, with the shadcn chart component (`pnpm dlx shadcn@3.5.0 add
  chart`). The user asked for shadcn's charts. The CLI also added a `components/ui/card.tsx` that nothing uses; it was
  removed.
- **Loading cost:** the chart is its own on-demand file (`screens/overview-chart.tsx`, 379 KB / 113 KB gzip). Only
  members who see it download it; the main file did not take recharts.
- **Before this:** a hand-written SVG chart was built first, in this same change. It was replaced when the user asked
  for shadcn charts, and its file and styles were removed.

## Money

Nothing is computed in the browser except the comparison percentage. Every amount is the API's, and the API's figures
are the existing report rules (S1 tests prove they equal the revenue, expenses and attendance reports).

## Verified (2026-10-21)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 27 files, **122 passed** (1 new: the comparison) |
| Live endpoint | `GET /reports/stats` answers 200 for the owner |
| Screenshots | owner at 1,440 px and on a phone (390 px): cards, chart, summary, today's sections; reception and accountant |

**Not verified:**
- **The chart's tooltip:** it needs hovering, which the screenshot script cannot do.
- **The ▲/▼ badges on screen:** the demo data has nothing in September, so every card shows the "nothing to compare"
  text. The comparison itself is unit-tested.
