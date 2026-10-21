# Platform admin panel: a sidebar instead of tabs, and the contact requests page (2026-10-21)

The user sent a screenshot of the panel (`#/platform/leads`) and asked to improve the page and turn the top tabs into a
sidebar.

## What changed

**The shell** (`PlatformShell`, `screens/platform/platform.tsx`)
- The same shadcn/ui Sidebar as the clinic dashboard (R1): on the right, collapsible to icons on desktop, a sheet on
  phones. Items with icons: العيادات, طلبات التواصل, الخطط, المستندات القانونية, السجل. A clinic's own page keeps
  «العيادات» active.
- Beside «طلبات التواصل», the number of new requests. Its badge sits at the item's end, so it never covers the icon.
- The admin (name and email) at the foot of the sidebar; «خروج» is in its menu, as in the clinic dashboard.
- A header with the sidebar toggle and the page's name. The old top bar and its styles are gone.

**Status figures that filter** (`StatusCards`, on the requests and clinics pages)
- The figures were display-only cards. Now each one is a toggle button (`aria-pressed`): pressing it shows that status
  only; pressing it again, or «الكل», shows everything. Each card has a coloured dot matching its badge in the table.
- On the requests page they replace the status dropdown (four statuses, four cards). The clinics page keeps its
  dropdown, which also has the statuses with no card (onboarding, cancelled).

**The contact requests table**
- Person: initials, name, clinic · city. Type (call or subscription, monthly or yearly) is its own column.
- The message is its own column, cut to two lines; the whole message is in the tooltip.
- The status column is the badge (plus who changed it last). The status dropdown that sat in every row, and its
  error-prone one-click change, moved into the row's «⋯» menu: اتصال, إرسال بريد, صفحة العيادة, then «نقل إلى: …» for
  each other status.
- The page header shows the number of requests.

**Fix found on the way:** a clinic's page labelled its four figures with leftover keys (`pl_members`, `pl_branches`,
`pl_patients`, `pl_appointments30`) that the i18n removal missed. They read الأعضاء, الفروع, المرضى and مواعيد آخر 30
يومًا again.

## Checks

- Lint, typecheck, 123 unit tests, build.
- Screenshots signed in as the platform admin (password, then the emailed code from Mailpit): requests and clinics at
  1440 px, the row menu, the requests page at 390 px.

## A clinic's page (same day, second request)

The user sent a screenshot of `#/platform/clinics/:id` and asked to improve it too.

- **Header:** breadcrumbs (العيادات › the clinic) instead of a bare link; the clinic's initials, name and status badge,
  slug and owner email (each isolated, so they keep their order); «إيقاف العيادة» moved to the header as a red outline
  button («إعادة تفعيل العيادة» when suspended by an admin).
- **Figures** with icons (members, branches, patients, appointments in 30 days), two per row on a phone.
- **Two columns** (one below 1100 px): the subscription facts as tiles, then «إدارة الاشتراك» with one row per action:
  label and explanation on one side, the control and its button on the other (change plan; activate, when trialing,
  past due or suspended; extend the trial, when trialing). Notes and the action history are in the side column.
- **History** is a timeline. On a clinic's own page it no longer offers «فتح العيادة» (the page you are on), and the
  admin's name and the date are isolated, so «Platform Admin · 2026/10/20 5:23 م» no longer scrambles in Arabic text.
- The suspension notice and the deletion card stay above the columns, where they are seen first.

Checks: lint, typecheck, 123 unit tests, build; screenshots of an active clinic and a clinic on trial at 1440 px, and
the trial clinic at 390 px.
