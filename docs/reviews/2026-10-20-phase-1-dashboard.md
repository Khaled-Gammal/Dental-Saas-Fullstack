# Phase 1 — Dashboard navigation architecture

Part of the three-phase improvement plan (see README roadmap). Goal: every resource gets dedicated, navigable
create/edit pages instead of forms that appear inside the list; shared chrome, hooks and pure models; tests and lint.

## What changed

- `router.ts` — pure hash-route grammar: `#/<page>`, `#/<page>/new[?query]`, `#/<page>/<id>/<action>`; a table of the
  actions each page offers, so an impossible URL parses to `not-found`. `href()`/`to.*` builders mean no screen spells a path.
- `hooks.ts` — `useRoute`, `navigate` (asks the unsaved-changes guard), `useUnsavedChanges` (in-app + `beforeunload`),
  `useLeave` (after a save: drop the guard, leave a one-shot notice, go to the list), `useFlash`.
- `ui/page.tsx` — `Breadcrumbs`, `RouteLink` (a real `<a>`: middle-click/copy address work), `FormPage` (heading focus,
  sticky Cancel/Save footer), `ResourceState` (loading / error / not found for edit pages), `NotFound`.
- `ui/confirm-dialog.tsx` — native `<dialog>`; used before deactivating a branch, doctor or service.
- `queries.ts` `useOne` — an edit page reads its item from the cached list (no second request).
- Screens: `branches/{list,form,hours}`, `doctors/{list,form,schedule}`, `services/{list,form}`, `overview`.
  New: branch edit page (address, city, phones, active switch — the API already supported it).
- Pure models: `service-model.ts` joins `hours-model.ts` / `schedule-model.ts`; `util.diffText` replaces three copies of
  the "send only what changed, emptied → null" logic (profile, branches, doctors).
- Tests: `src/__tests__/{router,hours-model,schedule-model,service-model}.test.ts` (15 cases, vitest).
- Tooling: root `eslint.config.js` (typescript-eslint, react-hooks, `withTenant`/`createDb` banned outside
  `shared/database` and the worker), `pnpm lint`, CI runs lint and the dashboard tests.

## Review findings fixed before merge

| Severity | Finding | Fix |
|---|---|---|
| High | `profile.tsx` would not type-check (`Partial<Record>` into an index signature). | Typed `Changes` alias end to end. |
| Medium | Schedule page went blank when the branches query failed. | Error/retry merged from both queries. |
| Medium | Edit forms diffed against the live query; a background refetch could make the form dirty and save a stale value over another user's change. | Baseline frozen in `useState` at mount (same discipline as the profile screen). |
| Medium | `FormPage` heading focus overrode `autoFocus` on create pages. | Heading takes focus only when nothing else did. |
| Low | Dialog `autoFocus` dead, hard-coded id; anchors styled as buttons underlined; sidebar links blocked middle-click and the drawer stayed open on same-page navigation; `isLoading` blank while offline; Safari `beforeunload`; `leave()` could yank the URL after the page unmounted. | All fixed; the save callback now lives on `mutate()` so it is skipped after unmount. |

## Verification done here

- Unit tests executed (esbuild bundle + node): 15/15 pass.
- Every route rendered in a headless browser (desktop + 390px): create/edit/hours/schedule/not-found, RTL breadcrumbs, sticky footer.

## Still to run on your machine

`pnpm install` (adds eslint, typescript-eslint, eslint-plugin-react-hooks, vitest) → `pnpm lint` → `pnpm typecheck` → `pnpm test`.
