# Overview: design review and the simple layout (2026-10-21)

The user asked for a redesign "for a strong UX/UI designer" with more charts. Partway through they asked for a design
as simple as the Untitled UI reference they had attached. That reference has a header with "Select date" and
"Export", four figure cards with a sparkline, one chart card, and one table card. This change is the simple layout.
On `v4/overview-redesign`, after the statistics commits.

## Design review of the previous version (what this fixes)

1. **Hierarchy:** the website link sat in the header's action slot while the period and branch sat on a second line
   under a second title. **Now:** the period, branch and «تصدير» are the header's actions, and the website link is a
   quiet line under the greeting.
2. **Noisy cards:** three lines of muted text per card, and «لا شيء في الفترة السابقة للمقارنة» four times, wrapping on
   phones. **Now:** a value on its own line, then a delta pill («—» with a tooltip when there is nothing to compare)
   with "عن الفترة السابقة", beside a sparkline.
3. **No trend at a glance.** **Now:** a sparkline per money and patient figure.
4. **Duplicated numbers:** the chart card repeated the cards' figures. **Now:** one chart and nothing repeated.
5. **Bad numbers looked like good ones.** **Now:** a negative net income is red.
6. **Inconsistent to-dos:** counts mixed with "!" marks, in a card competing with the table. **Now:** one slim amber line
   of links under the header («يحتاج انتباهك»), all with counts. The cash boxes not opened are one item that names the
   branches. When nothing waits, there is no line.
7. **Too much at once:** an intermediate version added an appointments donut and four breakdown cards (payment methods,
   expenses by item, doctors' work, outstanding) with three more requests. The user preferred the simple reference.
   Those breakdowns remain on the reports page, one click away; the extra requests are gone.

## The layout

| Reference | Overview |
| --- | --- |
| "Welcome back, Olivia" + description | «أهلًا، {name}» + role, «ملخص يومك في العيادة», website link |
| Select date · Export | period (today, this month by default, last month, this year) · branch (with several) · «تصدير»: the period's figures per day or month, with totals, as a CSV (UTF-8 for Excel, as the reports export) |
| 4 cards: icon + label, value, ▲ % vs last month, sparkline | net collections, net income, new patients, appointments (attended and no-shows under it); ▲/▼ against the previous period |
| "Engagement over time" line chart, legend below | «الإيرادات والمصروفات»: net collections and expenses lines (shadcn/ui chart; time right to left) |
| "Recent activity" table card, count, pagination | «مواعيد اليوم المتبقية»: the table edge to edge inside the card, its count, 6 rows a page, «كل المواعيد», a «⋯» menu per row |

- **Reception and doctors:** the same structure with their own today figures (appointments, collections, follow-ups) in
  the same cards, with no comparison or chart (statistics are `reports:read`). Then the attention line and the table.
- **Smooth lines:** the chart's lines use `monotone`, which never overshoots a point, and these amounts are never
  negative.
- **Chart colours:** they are theme tokens (`--chart-1` … `--chart-6` in `theme.css`), so later charts match.

## Money

Unchanged: every amount comes from `GET /reports/stats` or `/reports/home`. The only browser arithmetic is the ▲/▼
percentage (`change()`, tested). The CSV writes the API's amounts in pounds, the same `pounds()` the reports export
uses.

## Verified (2026-10-21)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 27 files, **122 passed** |
| Bundle | the charts are their own file (390 KB / 114 KB gzip), loaded only for owner and accountant; the main file is 399 KB |
| Screenshots | owner at 1,440 px and on a phone; reception at 1,440 px; no sideways scroll |

**Not verified:**
- **The CSV download:** the headless browser cannot save files.
- **Chart tooltips:** they need hovering.
- **▲/▼ on screen:** the demo has nothing in the previous period, so the cards show «—». The comparison is unit-tested.

Texts the intermediate versions added and the simple layout no longer uses were removed.
