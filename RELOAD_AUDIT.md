# Reload audit — 2026-11-13

The editor screenshot came from a server/client loading-branch mismatch. Its server request did not forward the viewer session, so the server rendered the centered loading placeholder. The browser loaded the authorized map and hydrated that same element as `EncounterMap`. Vue's production hydration checks do not repair every class mismatch: the loading element's flex alignment could survive, placing the toolbar, save status and canvas next to each other.

## Findings

| Affected example | Cause | Resolution and evidence |
| --- | --- | --- |
| Campaign map list: navigating to Maps and reloading produced different card layouts | Setup fetched separately on server/browser, without request-aware server authentication or a shared payload | Fixed in the previous change. Request-aware keyed async data; SSR/payload tests and browser comparison of the actual page remain covered. |
| Campaign map editor: toolbar and canvas became a centered horizontal row after reload; a failed load could remain at “Loading map editor…” | `await fetchMap()` used plain `$fetch`, swallowed access errors and kept map data in a setup-local ref | Fixed with request-aware keyed async data. The same map initializes SSR and hydration; failed requests propagate to the error page. Full page → `EncounterMap` → toolbar/canvas browser coverage verifies navigation, editing, autosave and a new document reload. |
| Workshop map editor, especially owned or hidden maps: direct reload could fail with 403/404 while client navigation worked | The same plain server map fetch, followed by an ownership check whose account fetch also lacked the viewer request | Fixed request-aware map loading and account initialization. The existing Workshop campaign/ownership restrictions remain enforced. Tests cover the owner, another account, map access failures and anonymous state isolation. |
| Shared authentication bootstrap: SSR account initialization was not carried into the browser payload, and mutable account/initialized refs were shared between server requests | Module-level refs in `useAuth` instead of request-scoped Nuxt state | Fixed with keyed `useState` and a request-bound `/api/auth/me` fetch. Components in one app share identity; separate server requests have separate state. Hydration retains the account and initialized flag. Tests verify all three properties; the Workshop reload browser test makes no extra map or account GET after hydration. |

## Audit coverage

The source audit covers **34 route pages, 42 shared components, 2 layouts, 39 composables, 4 middleware files, and the app root**. It inventories setup awaits, mounted loaders and module-level reactive composable state. After the fixes, no additional unwrapped setup-time fetch/load await or module-level reactive composable state is flagged.

All 34 routes are included in these groups:

| Route group | Pages | Loading reviewed |
| --- | ---: | --- |
| Campaign list, login, campaign creation | 3 | Client-mounted list loading or user-triggered actions |
| Campaign hub and settings | 2 | Mounted data and request-aware access middleware |
| Encounter list and encounter detail | 2 | Mounted loading and subsequent server/WebSocket refreshes |
| Library hub and rewards | 2 | Static navigation or mounted roster loading |
| Library Tamer routes | 3 | Mounted list loading and shared form component loading |
| Library Digimon routes | 3 | Mounted list loading and shared form component loading |
| Library evolution routes | 3 | Mounted loading and user-triggered updates |
| Library map routes | 3 | Map list/editor now hydrate keyed request-aware data; creation is user-triggered |
| Player selection, creation, dashboard, Tamer edit and Digimon create/edit | 6 | Mounted data and shared form loaders; persisted character/combat data refetched from the server |
| Workshop index and Tamer/Digimon/map create/edit | 7 | Mounted public roster/form loading; map editor now uses request-aware SSR data and account state |

The access middleware continues forwarding the viewer request through `useRequestFetch`; guards now share its result within one navigation. Client-side `useCookie`/`useRoute` callbacks after awaits were checked against the installed Nuxt implementation: client context remains available, so their presence alone was not reported as another reload failure. Locale/time text is client-mounted or client-only. The unused `useMapRotation` composable has no current caller and does not affect editor reloads.

Tool, selection and camera choices currently restart from their defaults on a new document; map geometry is persisted. This audit does not add persistence for temporary editor choices or unsaved character-form drafts.

## Verification

- Full suite including subsequent editor, navigation, participant batching and campaign roster changes: **1,603 passing tests**, no failures. Production Nuxt build passes. Typecheck retains the existing diagnostic baseline; changed authentication/editor page files introduce none.
- `mapEditorReload.test.mjs`: both real page setups, shared hydration data, access-error handling, Workshop owner enforcement, request isolation and authentication payload restoration.
- `verify-map-reload-browser.mjs`: both actual page templates, `EncounterMap`, actual toolbar, matching scoped styles, ClientOnly lifecycle and WebGL canvas. At **1440×900 and 390×844**, it navigates, places a block, waits for the save acknowledgement, reloads into a different document, checks the saved data, verifies vertical stacking/full canvas bounds and rejects browser/hydration/shader errors.
- Navigation follow-up: map list/editor async data is lazy on client transitions and remains request-aware on SSR. The browser holds map GET responses until the destination and loading state are visible, then releases them and completes edit/save/reload. Workshop map/account requests run concurrently, and ownership validation finishes before exposing the editor. Client failures show an error and Retry. Campaign guards share one authority request per navigation, scoped to the Nuxt app; each later navigation rechecks access, including revocation.
- `verify-map-layout.mjs`: editor, GM and player map hosts, with access banners and narrow toolbar wrapping. Its old toolbar stub has been updated to use the real editor composable.
- Existing map-list hydration/browser tests and the full regression suite cover the previous list fix and interactions with autosave, permissions and combat.

Commands from `app`:

```powershell
node --import ./scripts/offline-env.mjs scripts/audit-reload-paths.mjs
node --import ./scripts/offline-env.mjs --test tests/mapEditorReload.test.mjs tests/campaignMapHydration.test.mjs
node --import ./scripts/offline-env.mjs scripts/verify-map-reload-browser.mjs
node --import ./scripts/offline-env.mjs scripts/verify-map-layout.mjs
node --import ./scripts/offline-env.mjs scripts/verify-map-editor-browser.mjs
```

The inventory is written to ignored `app/.cache/reload-audit.json`. Full-page screenshots and measurements are in ignored `app/.cache/map-reload-verification/`. Browser verification uses local fixture APIs, Nuxt-style request data/state payloads, and Chrome SwiftShader; it does not contact production accounts or databases. The remaining routes were reviewed in source, rather than individually exercised against a live authenticated server. The static scan targets the patterns above and does not prove the absence of every possible runtime reload defect.
