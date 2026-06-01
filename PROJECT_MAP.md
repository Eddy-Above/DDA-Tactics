## Changelog
| Date | Sections Updated | Summary |
|------|-----------------|---------|
| 2026-06-01 | API Schema, Data Models, Pages & Components, Cross-Cutting Concerns | **Skill Orders homebrew** added. New per-campaign toggle `rulesSettings.skillOrders` unlocks one Skill Option per tamer skill. Unlock requires BOTH: skill total (base+XP) ≥ skill threshold (4/5/6 Std/En/Ex) AND the skill's governing attribute total ≥ first-special-order threshold (`specialOrderThresholds[level][0]` = 3/5/6). `app/data/skill-orders.ts` (new): `skillOrdersData` (15 options, one per skill), `SKILL_ORDER_SKILL_THRESHOLD`, `SKILL_ATTRIBUTE_MAP`. `app/utils/skillOrders.ts` (new): `getUnlockedSkillOrders()`, `getSkillOrderActionCost()` (Complex=2/Simple=1/else=0). New endpoint `POST /api/encounters/[id]/actions/skill-order` (`skill-order.post.ts`) — validates unlock + campaign toggle, per-battle via `participant.usedSkillOrders`, per-day via `tamer.usedPerDaySkillOrders`, all effects log-only (GM-resolved); passive orders (e.g. Bravado) skip usage tracking. New tamer column `used_per_day_skill_orders` (migration `0012_add_skill_orders.sql`), reset by `new-day.post.ts`. `useTamerForm` gains `unlockedSkillOrders` computed (grouped by attribute); `useCampaignContext` gains `skillOrdersEnabled`. TamerFormPage shows a Skill Orders section (gated on toggle); GM encounter page + player page both show a Skill Orders action panel for the active tamer (and a read-only sheet section on the player page); settings page adds the toggle. |
| 2026-06-01 | Pages & Components | Map view z-index fix: digimon character tokens (`MapCanvas.vue` `.char-overlays`, HTML overlays painted over the canvas) lowered from `z-index: 40` to `15` so they no longer render on top of `EncounterMap.vue`'s chrome overlays (combat log / `MapBattleLog`, player HUD, turn-order, combat-controls — all `z-index: 20`). Tokens still sit above the WebGL canvas; in-canvas popups (health-bar 30, radial menu 35, move label 28, view-controls 25) remain above tokens. Fixes both GM and player map views via shared MapCanvas. |
| 2026-06-01 | API Schema, Data Models, Pages & Components | **Inspiration mechanic** implemented. Tamer `CombatParticipant` gains `currentInspiration` (live pool initialized at encounter join from `inspiration + grantedInspiration + xpBonuses.inspiration`), `divineProtectionUsesThisBattle`, `pendingDivineProtectionDamage`, `pendingSimpleActionPenalty`. New constants `INSPIRATION_ACT_COST` (2/4/6) and `INSPIRATION_FATEFUL_COST` (5/7/10) per `CampaignLevel` in `types/index.ts`. New endpoints `POST /actions/spend-inspiration` (`{participantId, spendType: 'reroll'\|'modifier'\|'act-of-inspiration'\|'fateful-intervention', amount}` — validates special-type cost vs campaign level, deducts from participant + syncs to tamer DB base→granted→xp) and `POST /actions/grant-inspiration` (`{participantId, amount}` — GM increments participant + tamer `grantedInspiration`). **Divine Protection** is a reactive pending-request flow: `responses.post.ts` dodge-rolled damage branch intercepts when a hit lands on a tamer (first use free, subsequent require ≥2 Insp), holds damage in `pendingDivineProtectionDamage`, and creates a `divine-protection-offer` request instead of applying wounds; new response types `divine-protection-used` (negates damage, +1 DP use, −2 Insp if not first, sets `pendingSimpleActionPenalty`) and `divine-protection-declined` (applies held damage). `useEncounters.ts` `nextTurn()` applies `pendingSimpleActionPenalty` when a participant's turn begins. GM page: inspiration badge + inline "+ Grant Inspiration" on tamer cards, DP offer Protect/Take-Hit buttons in pending-requests panel. Player page: inspiration pip display, spend panel (re-roll/modifier/Act/Fateful), DP offer modal. |
| 2026-06-01 | API Schema, Data Models | Mode Change [T] / Mode Change X.0 [T] implemented. New endpoint `POST /api/encounters/[id]/actions/mode-change` (body: `{ participantId, newSwaps }`): validates Mode Change quality rank, costs 1 Simple Action, stores `statSwaps` on `CombatParticipant`. `statSwaps` is `Partial<Record<'accuracy'|'damage'|'dodge'|'armor', same>>` — key=slot, value=source stat — applied to damage/armor reads in `computeAttackDamage.ts` and to dodge pool in `resolveNpcAttack.ts` before quality/stance modifiers. UI: swap pair toggle buttons on digimon cards + active-swap badge next to stance badge. |
| 2026-06-01 | Pages & Components, Dependency Graph | Blast attack aiming overhaul + faction-aware movement. **Blast targeting** (`MapCanvas.vue`): mouse now controls the blast center's XZ position (was fixed at radius distance); scroll wheel raises/lowers the center's Y level (works on canvas and over overlays, blocks camera zoom); center is clamped to the attacker's effective limit in 3D (Y consumes budget first, remaining `√(limit²−dy²)` bounds XZ) and Y may go negative (underground). Full sphere is ghost-highlighted including empty-air cells; line-of-sight from attacker→center is raycast against solid meshes only (LineSegments excluded to avoid false blocks), dim-red tiles + suppressed click when blocked; range rings (green=Range, orange=Effective Limit) shown while aiming; left-click confirms, right-click cancels. The `selectedAttack` watcher only re-initialises Y when newly entering blast targeting so the poll loop's prop re-creation doesn't reset it. `app/utils/areaShapes.ts` `computeAreaCells`/`computeBlast` gain optional `blastCenter` param (enumerates every integer cell in the sphere via 3D distance) and use `Math.ceil((3+bit)/2)` radius; `app/server/utils/areaShapes.ts` `computeBlastCells` radius likewise `Math.ceil`. **Faction-aware movement** (`useMapMovement.ts` `computeReachable`/`computePath` gain `moverIsEnemy` param): same-faction units are passable-only (allies pass through each other), cross-faction units use size-based blocking; `EncounterMap.vue` computes `moverIsEnemy`, threads it through, and routes the player radial `move` action internally (same as NPC move). |
| 2026-06-01 | API Schema | Intercede spatial validation: `intercede-offer.post.ts` now validates that the original target has a valid non-occupied displacement position before creating any intercede offers (melee only — ranged intercede positions target on line-of-fire instead). Unplaced interceptors (no map position) are now correctly marked ineligible. Each intercede-offer request stores `interceptePos`, `isRangedIntercede`, `requiresJump`, `requiresFly`, and `fallHeight`. `intercede-claim.post.ts` loads the map for position validation, uses size-aware displacement (interceptor footprint dimension × direction), BFS fallback if preferred direction is blocked, skips target movement for ranged intercede, and applies `max(0, fallHeight-1)` fall damage to interceptors who jumped to intercede. `server/utils/mapMovement.ts` gains 8 new exports: `isValidLandingPosition`, `getSizeFootprintDimension`, `getFootprintCells`, `isFootprintValid`, `findClosestValidDisplacementPosition`, `getCellsOnLine`, `findRangedIntercedPosition`, `classifyReachability`. |
| 2026-05-26 | API Schema, Pages & Components | GM page map wound sync: `GET /api/digimon` now accepts `ids` (comma-separated) query param to fetch digimon by specific IDs. GM encounter page adds `syncEncounterDigimon()` — called on mount and every poll tick — which identifies encounter participant digimon missing from `digimonList` (e.g. legacy enemies with `campaignId=null`) and fetches+merges them so `digimonMapForMap` and `MapPlayerHUD` allEntries can render their wound bars. |
| 2026-05-26 | Pages & Components, Dependency Graph | Map-based attack targeting: `app/utils/areaShapes.ts` (new) — client-side area shape computation (blast/burst/close-blast/cone/line/pass). MapCanvas gains AOE highlight rendering (amber tiles via `aoeGroup`), mouse-tracked area preview, `area-attack-confirmed` emit, and map-click target confirmation; AOE filtering on reticules. EncounterMap forwards `area-attack-confirmed`. Both GM (`encounters/[id].vue`) and player (`player/[tamerId].vue`) pages wire `mapSelectedAttackProp` computed + `onMapTargetSelected` + `onMapAreaAttackConfirmed` handlers; `selectAttackAndShowTargets` skips target modal when in map view. `mapSelectedAttackProp` now includes `effectiveLimit` and `meleeRange` derived from the attacking participant (not active-turn participant); `attackerStats` in EncounterMap uses these values when present to fix reticule range when attacker ≠ active-turn participant. |
| 2026-05-26 | API Schema | Map-aware intercede: single-target intercede-offer now spatially gates digimon eligibility (same pattern as area-attack path) — digimon must be able to reach intercedee's tile within movement budget when a map is attached. intercede-claim now swaps positions on claim: interceptor moves to intercedee's tile; intercedee moves one step further from attacker (dir = sign(target - attacker)); both single-target DB saves (support-attack and damage-attack paths) persist `participantPositions`. |
| 2026-05-26 | Pages & Components | Map view attack picker: MapCanvas emits `player-action` via player radial menu (Move/Attack for own active digimon); EncounterMap passes `player-action` through; GM NPC attack now shows floating attack picker overlay (`npcAttackParticipantId`) instead of auto-picking first attack; player map attack shows floating attack picker overlay (`playerAttackParticipantId`) |
| 2026-05-25 | Pages & Components | Player view: initiative tracker hidden during `initiative` phase, shown in `setup` and `combat`; map view button moved to Turn Tracker header; map overlay hoisted outside combat-only banner so it works in any phase; `tamerMapForMap` and `digimonMapForMap` now read `currentWounds`/`maxWounds` from encounter participant instead of DB records |
| 2026-05-25 | Pages & Components, Dependency Graph | Map import/export: `useLibraryImportExport` gains `exportMap`, `exportMaps`, `importMaps`; maps library page adds Import, Export All, and per-card Export buttons |
| 2026-05-25 | API Schema, Dependency Graph | NPC defeat auto-advance: when a defeated NPC is removed from turnOrder during its own turn, the server now automatically advances currentTurnIndex to the next participant (wrapping to round 0 if last). `resolveNpcAttack` returns `nextTurnIndex?` and `nextRound?`; propagated through `triggerCounterattack`, `resolveAreaIntercedeGroup`, and all call sites in `npc-attack.post`, `intercede-offer.post`, `intercede-skip.post`, `intercede-claim.post`, `attack.post`, `responses.post`. `triggerCounterattack` now accepts `turnOrder?` and `currentTurnIndex?` params. |
| 2026-05-05 | Pages & Components, API Schema | Performance: removed redundant fetchEncounter after attacks/intercede handlers; intercede action handlers now use returned API state directly; polling loop stripped to encounter-only (tamers/evolutions loaded once on mount); deep watcher on currentEncounter replaced with targeted computed; intercede-offer.post.ts now batch-fetches all participant digimon/tamer records upfront (inArray) instead of N sequential per-participant queries; canReachTarget made synchronous using pre-fetched map |
| 2026-05-05 | Pages & Components | Mid-combat initiative: DM can send initiative-roll request to tamer participants during combat phase; processResponse branch 2 also updates partner digimon initiative; inline initiative edit added to participant cards (DM only, pencil icon, updates partner digimon + re-sorts turn order) |
| 2026-04-23 | All sections | 3D isometric map system added: maps table, WebSocket sync, Three.js MapCanvas, map library pages, attack range validation, area attack shapes, spatial intercede eligibility, gigantic digimon dimensions |
| 2026-04-14 | API Schema | Effect duration timing changed: durations now decrement at end of affected target's own turn (not start of round); Poison damage likewise fires at end of each poisoned participant's turn. useEncounters.ts nextTurn() updated. |
| 2026-04-14 | API Schema | Haste effect wired up: attack.post.ts enforces Complex Action cost and blocks bolster/lifesteal; useEncounters.ts grants +1 simple action at round start; canBolsterAttack() blocks bolster for Haste attacks |
| 2026-04-14 | Env Variables, Pages, Dependency Graph, Blast Radius | Fixed DATABASE_URL Read By column (added migrate.mjs, run-migrations.mjs); corrected player/[tamerId].vue route path (was wrongly listed as index.vue); added computeAttackDamage.ts to graph and blast radius |

---

# Project Map: DDA Tactics (Digimon Session Helper)
> Deep analysis of project. Read this file to understand the full project context.

> ⚠️ AUTH: All API routes are unprotected server-side. Security relies entirely on client-side middleware cookies. Any direct API request bypasses auth.

---

## 1. Build & Runtime
> Last verified: 2026-04-14

**Sources:** `package.json`, `nuxt.config.ts`, `tsconfig.json`, `drizzle.config.ts`

| Property | Value |
|---|---|
| Project name | `dda-tactics` v0.1.0 |
| Description | Tactical GM aid for Digimon Digital Adventure 1.4 TTRPG |
| Language | TypeScript (strict mode, `strictNullChecks`, `noImplicitAny`) |
| Framework | Nuxt 3.13 + Vue 3.5 (Nitro server, Vite build) |
| Runtime | Node.js |
| Database | PostgreSQL via `postgres` ^3.4.8 + Drizzle ORM ^0.33 |
| CSS | Tailwind CSS 3 via `@nuxtjs/tailwindcss` ^6.12 |
| Package manager | npm (package-lock.json) |
| Monorepo | No — single app |

**Scripts:**
```
npm run dev          # nuxt dev — local development server
npm run build        # nuxt build — production build → .output/server/index.mjs
npm run start        # node .output/server/index.mjs — run production build
npm run generate     # nuxt generate — static site generation (not used in prod)
npm run db:generate  # drizzle-kit generate — generate migration SQL from schema
npm run db:migrate   # drizzle-kit migrate — apply pending migrations
npm run db:push      # drizzle-kit push — push schema directly (dev only)
npm run db:studio    # drizzle-kit studio — visual DB browser
```

**Key config:**
- `nuxt.config.ts`: Tailwind module, strict TypeScript, Nitro experimental database, no devtools in prod, `runtimeConfig.dbPath` (legacy, unused — real DB via `DATABASE_URL`)
- `tsconfig.json`: Extends `.nuxt/tsconfig.json`
- `drizzle.config.ts`: Schema at `server/db/schema.ts`, migrations at `server/db/migrations/`, dialect `postgresql`
- `tailwind.config.ts`: Custom theme — `digimon-dark` (background palette), `digimon-orange` (accents), stage colors (fresh→ultra), attribute colors (vaccine/data/virus/free), fonts Orbitron (display) + Inter (body)
- **CORS:** No CORS policy configured — no `routeRules`, no `cors` header config in `nuxt.config.ts`. Nitro defaults apply (no CORS headers sent).
- **Deployment:** No Procfile, `railway.toml`, or deploy scripts found. App is deployed to Railway; deploys are triggered by git push (Railway auto-detects Node/Nuxt). Requires `DATABASE_URL` in Railway environment. Build: `npm run build` → `node .output/server/index.mjs`.
- **Sprite storage:** `spriteUrl` is a plain text field in the DB (`digimon.sprite_url`, `tamers.sprite_url`). No file upload infrastructure — users paste external image URLs directly. `SpritePreview.vue` renders them as `<img :src="...">`. No CDN, no `public/` sprite folder, no server-side upload endpoint.

---

## 2. Environment Variables
> Last verified: 2026-04-14

**Sources:** `server/db/index.ts`, `drizzle.config.ts`, `.env.local`, `migrate.mjs`, `run-migrations.mjs`

| Variable | Read By | Default | Required | Build/Runtime | Purpose |
|---|---|---|---|---|---|
| `DATABASE_URL` | `server/db/index.ts`, `drizzle.config.ts`, `migrate.mjs`, `run-migrations.mjs` | `''` (drizzle config), throws if missing (db/index.ts) | Yes | Runtime | PostgreSQL connection string (Railway in prod) |

No other env vars detected. The Nuxt `runtimeConfig.dbPath` in `nuxt.config.ts` is a leftover from a SQLite era and is not actively used — the real connection is `DATABASE_URL`.

---

## 3. API Schema
> Last verified: 2026-04-14

**Sources:** `server/api/**/*.ts` (all Nitro file-based routes)

All routes return JSON. No auth middleware on API routes — access is enforced by client-side Nuxt middleware (`middleware/campaign-access.ts`, `middleware/dm-access.ts`) via cookies. No rate limiting.

### Campaigns — `server/api/campaigns/`

| Method | Path | Handler File | Request Body / Params | Response |
|---|---|---|---|---|
| GET | `/api/campaigns` | `campaigns/index.get.ts` | — | `Campaign[]` |
| POST | `/api/campaigns` | `campaigns/index.post.ts` | `{name, description, level, password?, dmPassword?, rulesSettings?}` | `Campaign` |
| GET | `/api/campaigns/[id]` | `campaigns/[id].get.ts` | path: `id` | `Campaign` |
| PUT | `/api/campaigns/[id]` | `campaigns/[id].put.ts` | path: `id`, body: partial `Campaign` fields | `Campaign` |
| DELETE | `/api/campaigns/[id]` | `campaigns/[id].delete.ts` | path: `id` | `{success: true}` |
| POST | `/api/campaigns/[id]/verify-password` | `campaigns/[id]/verify-password.post.ts` | `{password}` | `{success: bool}` + sets cookie `campaign-access-{id}` |
| POST | `/api/campaigns/[id]/verify-dm-password` | `campaigns/[id]/verify-dm-password.post.ts` | `{password}` | `{success: bool}` + sets cookie `campaign-dm-{id}` |
| POST | `/api/campaigns/[id]/new-day` | `campaigns/[id]/new-day.post.ts` | path: `id` | Resets `digivolutionsUsedToday`, `usedPerDayOrders`, `usedPerDaySkillOrders` on all tamers/digimon in campaign |
| POST | `/api/admin/backfill-digimon-campaigns` | `admin/backfill-digimon-campaigns.post.ts` | — | Migration utility — backfills `campaignId` on digimon records |

### Digimon — `server/api/digimon/`

| Method | Path | Handler File | Request Body | Response |
|---|---|---|---|---|
| GET | `/api/digimon` | `digimon/index.get.ts` | query: `campaignId?`, `partnerId?`, `isEnemy?`, `stage?`, `ids?` (comma-separated) | `Digimon[]` |
| POST | `/api/digimon` | `digimon/index.post.ts` | Full `Digimon` shape (name, stage, attribute, baseStats, attacks, qualities, etc.) | `Digimon` |
| GET | `/api/digimon/[id]` | `digimon/[id].get.ts` | path: `id` | `Digimon` |
| PUT | `/api/digimon/[id]` | `digimon/[id].put.ts` | Partial `Digimon` fields | `Digimon` |
| DELETE | `/api/digimon/[id]` | `digimon/[id].delete.ts` | path: `id` | `{success: true}` |

### Tamers — `server/api/tamers/`

| Method | Path | Handler File | Request Body | Response |
|---|---|---|---|---|
| GET | `/api/tamers` | `tamers/index.get.ts` | query: `campaignId?` | `Tamer[]` |
| POST | `/api/tamers` | `tamers/index.post.ts` | Full `Tamer` shape | `Tamer` |
| GET | `/api/tamers/[id]` | `tamers/[id].get.ts` | path: `id` | `Tamer` |
| PUT | `/api/tamers/[id]` | `tamers/[id].put.ts` | Partial `Tamer` fields | `Tamer` |
| DELETE | `/api/tamers/[id]` | `tamers/[id].delete.ts` | path: `id` | `{success: true}` |

### Evolution Lines — `server/api/evolution-lines/`

| Method | Path | Handler File | Request Body | Response |
|---|---|---|---|---|
| GET | `/api/evolution-lines` | `evolution-lines/index.get.ts` | query: `campaignId?`, `partnerId?` | `EvolutionLine[]` |
| POST | `/api/evolution-lines` | `evolution-lines/index.post.ts` | `{name, partnerId, campaignId, chain}` | `EvolutionLine` |
| GET | `/api/evolution-lines/[id]` | `evolution-lines/[id].get.ts` | path: `id` | `EvolutionLine` |
| PUT | `/api/evolution-lines/[id]` | `evolution-lines/[id].put.ts` | Partial fields | `EvolutionLine` |
| DELETE | `/api/evolution-lines/[id]` | `evolution-lines/[id].delete.ts` | path: `id` | `{success: true}` |
| POST | `/api/evolution-lines/[id]/refresh` | `evolution-lines/[id]/refresh.post.ts` | — | Re-syncs chain digimon data |

### Encounters — `server/api/encounters/`

**Core CRUD:**

| Method | Path | Handler File | Notes |
|---|---|---|---|
| GET | `/api/encounters` | `encounters/index.get.ts` | query: `campaignId?` |
| POST | `/api/encounters` | `encounters/index.post.ts` | Creates encounter with participants; accepts `mapId?` |
| GET | `/api/encounters/[id]` | `encounters/[id].get.ts` | Full encounter with participants, log, `participantPositions`, `destructibleStates` |
| PUT | `/api/encounters/[id]` | `encounters/[id].put.ts` | Update encounter state; accepts `mapId`, `participantPositions`, `destructibleStates` |
| DELETE | `/api/encounters/[id]` | `encounters/[id].delete.ts` | — |
| WS | `/api/encounters/[id]/ws` | `encounters/[id]/ws.ts` | WebSocket: real-time map sync; messages: `unit-moved`, `map-edited`, `door-toggled`, `element-painted`, `structure-damaged`, `full-state` |

### Maps — `server/api/maps/`

| Method | Path | Handler File | Notes |
|---|---|---|---|
| GET | `/api/maps?campaignId=` | `maps/index.get.ts` | List maps by campaign |
| POST | `/api/maps` | `maps/index.post.ts` | Create map; body: `{name, description, campaignId, dimensions}` |
| GET | `/api/maps/[mapId]` | `maps/[mapId].get.ts` | Fetch full map |
| PUT | `/api/maps/[mapId]` | `maps/[mapId].put.ts` | Update map tiles/structures |
| DELETE | `/api/maps/[mapId]` | `maps/[mapId].delete.ts` | Delete map |

**Request/Response management (player action coordination):**

| Method | Path | Handler File | Notes |
|---|---|---|---|
| POST | `/api/encounters/[id]/requests` | `encounters/[id]/requests.post.ts` | Create pending action request for a player; types: `digimon-selection`, `initiative-roll`, `dodge-roll`, `intercede-offer`, `health-roll`, `recovery-check`, `divine-protection-offer`; `recovery-check` data: `{ tamerParticipantId, digimonParticipantId, rookieDigimonId }`; `divine-protection-offer` data: `{ pendingDamage, targetName, attackerName, targetParticipantId, firstUse, inspirationCost }` |
| DELETE | `/api/encounters/[id]/requests/[requestId]` | `encounters/[id]/requests/[requestId].delete.ts` | Remove resolved request |
| POST | `/api/encounters/[id]/responses` | `encounters/[id]/responses.post.ts` | Player submits response to request; `recovery-rolled` type: `{ tamerSuccesses, digimonSuccesses, tamerDiceResults, digimonDiceResults }` — server recovers wounds on tamer participant and rookie digimon (participant JSON if already at rookie, or DB record if devolved from higher stage), removes request immediately. **Divine Protection**: the `dodge-rolled` damage branch intercepts a hit on a tamer (when eligible) and creates a `divine-protection-offer` instead of applying wounds; `divine-protection-used` negates the held damage (+1 DP use, −2 Insp if not first use, sets next-turn `pendingSimpleActionPenalty`), `divine-protection-declined` applies the held `pendingDivineProtectionDamage` |
| DELETE | `/api/encounters/[id]/responses/[responseId]` | `encounters/[id]/responses/[responseId].delete.ts` | Remove processed response |

**Combat Actions — `server/api/encounters/[id]/actions/`:**

All are POST. Body always includes `encounterId` (path param) + action-specific fields.

| Endpoint | Handler | Key Inputs | Effect |
|---|---|---|---|
| `attack` | `attack.post.ts` | `attackerId`, `targetId` OR `targetIds[]` (area), `attackId`, `bolster?`, `isClashAttack?` | Rolls accuracy vs target dodge, applies damage, deducts actions once; when `targetIds` provided (area attack), delegates to `intercede-offer` with all targetIds after single action deduction; handles Bolster, Lifesteal, Huge Power, Signature Move battery, Haste (Complex Action cost, blocks bolster/lifesteal); triggers counterattack on miss; creates dodge/intercede request for player targets |
| `npc-attack` | `npc-attack.post.ts` | `attackerId`, `targetId`, `attackId`, `combatMonsterBonus?` | Full server-side attack resolution for NPC→player; rolls dice, calculates net successes, applies wounds; auto-devolves on KO; removes defeated NPCs; if defeated NPC was active turn participant, auto-advances currentTurnIndex to next (wraps and resets round if last) |
| `intercede-offer` | `intercede-offer.post.ts` | `attackId`, `targetId` (single) or `targetIds[]` (area), roll data | Single-target: creates one intercede-offer per eligible tamer + GM. Support attacks go through intercede same as damage attacks — only exception is single-target melee self-buff (attacker===target), which resolves immediately. Area attack: deducts actions once, NPC targets auto-resolved via support or damage resolvers, creates ONE request per eligible tamer with `data.areaTargetIds` + `isAreaAttack: true`; excludes tamers/partners who are themselves targets |
| `intercede-claim` | `intercede-claim.post.ts` | `requestId`, `interceptorParticipantId`, `chosenTargetId?` (area only) | Player steps in to take hit for ally; area attacks: 409 if target already claimed, strips chosen target from other group requests, creates dodge-rolls for any uncovered remaining targets |
| `intercede-skip` | `intercede-skip.post.ts` | `requestId`, `optOut?` | Player declines intercede; area attacks: creates dodge-rolls for all targets not covered by remaining requests; opt-out adds all areaTargetIds to intercedeOptOuts; NPC fallback uses support resolver (resolvePositiveAuto/resolvePositiveHealth/resolveNegativeSupportNpc) when `isSupportAttack` is true |
| `quick-reaction` | `quick-reaction.post.ts` | `requestId`, `tamerParticipantId` | Tamer with Quick Reaction order grants partner +Stage Bonus+2 Dodge Dice; area attacks: server resolves partner from areaTargetIds, strips QR target from other requests, creates dodge-rolls for uncovered remaining targets |
| `digivolve` | `digivolve.post.ts` | `participantId`, `targetStageIndex`, `evolutionLineId?`, `isWarp?` | Evolves/devolves digimon in combat; full heal on evolve; restores prior wounds on devolve; validates unlock status, warp DC (vs campaign level), 5/day EddySoul limit; costs 1 simple action |
| `digivolve-fail` | `digivolve-fail.post.ts` | `participantId` | Marks failed warp evolution attempt; sets `hasAttemptedDigivolve` |
| `clash-initiate` | `clash-initiate.post.ts` | `initiatorId`, `targetId`, `bolster?` | Rolls Body + size bonus vs target Agility; sets `clash` state on both; creates pending request for player targets; Wrestlemania: free once/round; Multi-Grappler support |
| `clash-check` | `clash-check.post.ts` | `requestId`, `participantId`, `roll`, `bolster?` | Player responds to clash attempt; determines controller via opposed roll |
| `clash-action` | `clash-action.post.ts` | `participantId`, `actionType` (`attack`\|`break`\|`pin`) | Controller attacks with half dodge pool for target; controlled tries to break free; resolves outcomes and updates clash state |
| `clash-break` | `clash-break.post.ts` | `breakerId`, `clashParticipantId` | Third party breaks clash with Body opposed roll; costs 2 simple actions |
| `direct` | `direct.post.ts` | `tamerId`, `targetParticipantId`, `bolster?` | Tamer buffs digimon next accuracy/dodge roll; +Charisma (partner) or +Charisma-2 (non-partner); bolster adds +2; applies "Directed" effect (duration 99, consumed on use); once per turn |
| `special-order` | `special-order.post.ts` | `tamerId`, `orderId`, `targetId?` | Validates unlock (attributes + XP bonuses); checks per-battle/per-day limits; executes: Energy Burst (heal 5), Swagger (Taunt), Enemy Scan (Debilitate -2), Tough it Out! (remove debuff); others logged for GM |
| `skill-order` | `skill-order.post.ts` | `participantId`, `orderName` | Homebrew (gated on `rulesSettings.skillOrders`). Validates skill+attribute unlock via `getUnlockedSkillOrders`; per-battle via `participant.usedSkillOrders`, per-day via `tamer.usedPerDaySkillOrders`; deducts `getSkillOrderActionCost` simple actions; all effects log-only (GM resolves); passive orders (e.g. Bravado) repeatable, skip usage tracking |
| `cheer-up` | `cheer-up.post.ts` | `tamerId`, `targetParticipantId` | Requires Positive Reinforcement quality + mood=1; sets mood to 4; costs 2 simple actions (Complex) |
| `mode-change` | `mode-change.post.ts` | `participantId`, `newSwaps` | Requires Mode Change quality; costs 1 simple action; sets `participant.statSwaps` (stat pair swap for combat resolution); validates swap against quality rank (MC rank 1: damage↔armor only; rank 2: also accuracy↔dodge; X.0 rank 1: any pair; X.0 rank 2: any permutation) |
| `spend-inspiration` | `spend-inspiration.post.ts` | `participantId`, `spendType`, `amount` | Tamer-only; deducts `amount` from `participant.currentInspiration` and syncs to tamer DB (base→granted→xp); validates `act-of-inspiration` (=`INSPIRATION_ACT_COST[level]`) / `fateful-intervention` (=`INSPIRATION_FATEFUL_COST[level]`) costs; logs the spend. Effect on the roll is applied by the GM (no action cost — spendable freely) |
| `grant-inspiration` | `grant-inspiration.post.ts` | `participantId`, `amount` | GM grants `amount` Inspiration to a tamer participant; increments `participant.currentInspiration` + tamer `grantedInspiration`; logs grant |

---

## 4. Data Models & Storage
> Last verified: 2026-04-14

**Sources:** `server/db/schema.ts`, `server/db/index.ts`, `drizzle.config.ts`

**Engine:** PostgreSQL. **ORM:** Drizzle. **Migrations:** `server/db/migrations/` (0000–0009; note: 0002 is missing — sequence gap, appears intentional). No caching layer (no Redis). No message queue.

### Table: `tamers`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | Nanoid generated |
| `name` | text | — |
| `age` | integer | — |
| `campaignId` | text FK → campaigns | — |
| `attributes` | jsonb | `{agility, body, charisma, intelligence, willpower}` (integers) |
| `skills` | jsonb | `{dodge, fight, stealth, athletics, endurance, featsOfStrength, manipulate, perform, persuasion, computer, survival, knowledge, perception, decipherIntent, bravery}` |
| `aspects` | jsonb | `Array<{id, name, description, type:'major'\|'minor', usesRemaining}>` |
| `torments` | jsonb | `Array<{id, name, description, severity:'minor'\|'major'\|'terrible', totalBoxes, markedBoxes, cpMarkedBoxes?}>` |
| `specialOrders` | jsonb | `string[]` (unlocked order IDs) |
| `xpBonuses` | jsonb | `{attributes, skills, inspiration}` |
| `equipment` | jsonb | `string[]` |
| `usedPerDayOrders` | jsonb | `string[]` (reset on `new-day`) |
| `usedPerDaySkillOrders` | jsonb | `string[]` (skill orders used today; reset on `new-day`; migration 0012) |
| `inspiration` | integer | — |
| `grantedInspiration` | integer | — |
| `xp` | integer | — |
| `currentWounds` | integer | — |
| `digivolutionsUsedToday` | integer | Reset on `new-day` |
| `notes` | text | — |
| `spriteUrl` | text | — |
| `createdAt` | timestamp | — |
| `updatedAt` | timestamp | — |

### Table: `digimon`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | — |
| `name` | text | Species name |
| `nickname` | text | Player-given name |
| `stage` | text | `'fresh'\|'in-training'\|'rookie'\|'champion'\|'ultimate'\|'mega'\|'ultra'` |
| `attribute` | text | `'vaccine'\|'data'\|'virus'\|'free'` |
| `family` | text | 10 families (dark-empire, deep-savers, etc.) |
| `type` | text | Free text classification |
| `size` | text | `'tiny'\|'small'\|'medium'\|'large'\|'huge'\|'gigantic'` |
| `partnerId` | text FK → tamers | Null for enemy/library digimon |
| `isEnemy` | boolean | — |
| `isDarkEvolution` | boolean | — |
| `campaignId` | text FK → campaigns | — |
| `baseStats` | jsonb | `{accuracy, damage, dodge, armor, health}` (integers) |
| `attacks` | jsonb | `Array<{id, name, range, type, tags, effect?, description}>` |
| `qualities` | jsonb | `Array<{id, name, type, dpCost, description, effect, ranks?, choiceId?, choiceName?}>` |
| `bonusStats` | jsonb | `{accuracy, damage, dodge, armor, health}` from DP allocation |
| `evolutionPathIds` | jsonb | `string[]` — linked evolution line IDs |
| `dataOptimization` | text | Quality choice for Data Optimization |
| `baseDP` | integer | DP from stage |
| `bonusDP` | integer | Extra DP purchased |
| `bonusDPForQualities` | integer | DP reserved for qualities |
| `currentWounds` | integer | — |
| `currentStance` | text | `'neutral'\|'defensive'\|'offensive'\|'sniper'\|'brave'` |
| `evolvesFromId` | text | Links to pre-evolution digimon |
| `notes` | text | — |
| `spriteUrl` | text | — |
| `createdAt` | timestamp | — |
| `updatedAt` | timestamp | — |

### Table: `encounters`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | — |
| `name` | text | — |
| `description` | text | — |
| `campaignId` | text FK → campaigns | — |
| `round` | integer | Current round number |
| `phase` | text | `'setup'\|'initiative'\|'combat'\|'ended'` |
| `participants` | jsonb | `CombatParticipant[]` — full combat state per actor (see types) |
| `turnOrder` | jsonb | `string[]` — participant IDs in initiative order |
| `battleLog` | jsonb | `BattleLogEntry[]` — complete action history |
| `hazards` | jsonb | `EnvironmentHazard[]` |
| `pendingRequests` | jsonb | `PendingRequest[]` — awaiting player input (dodge, intercede, clash, recovery-check) |
| `requestResponses` | jsonb | `RequestResponse[]` — submitted player responses |
| `createdAt` | timestamp | — |
| `updatedAt` | timestamp | — |

### Table: `campaigns`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | — |
| `name` | text | — |
| `description` | text | — |
| `level` | text | `'standard'\|'enhanced'\|'extreme'` |
| `passwordHash` | text | bcrypt; null if no password |
| `dmPasswordHash` | text | bcrypt; null if no DM password |
| `rulesSettings` | jsonb | `CampaignRulesSettings` — EddySoulRules + HouseRules + TormentRequirements + SkillRenames |
| `createdAt` | timestamp | — |
| `updatedAt` | timestamp | — |

### Table: `evolutionLines`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | — |
| `name` | text | — |
| `description` | text | — |
| `partnerId` | text FK → tamers | — |
| `campaignId` | text FK → campaigns | — |
| `currentStageIndex` | integer | Active stage in chain |
| `chain` | jsonb | `Array<{stage, species, digimonId?, isUnlocked, evolvesFromIndex?}>` |
| `createdAt` | timestamp | — |
| `updatedAt` | timestamp | — |

### Table: `maps`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | — |
| `name` | text | — |
| `description` | text | — |
| `campaignId` | text FK → campaigns | — |
| `dimensions` | jsonb | `{width, depth, height}` |
| `groundTiles` | jsonb | `MapGroundTile[]` — `{x,y,z,element,terrain}` |
| `spaceTiles` | jsonb | `MapSpaceTile[]` — `{x,y,z,spaceType}` |
| `walls` | jsonb | `MapWall[]` — `{id,x,y,z,face,woundBoxes?}` |
| `windows` | jsonb | `MapWindow[]` — `{id,wallId,woundBoxes?}` |
| `doors` | jsonb | `MapDoor[]` — `{id,wallId,isOpen}` |
| `ceilings` | jsonb | `MapCeiling[]` — `{id,x,y,z,woundBoxes?}` |
| `stairs` | jsonb | `MapStair[]` — `{id,x,y,z,face}` |
| `createdAt` / `updatedAt` | timestamp | — |

**New columns on existing tables:**
- `encounters.mapId` — text nullable FK → maps
- `encounters.participantPositions` — jsonb `Record<participantId, Vec3>`
- `encounters.destructibleStates` — jsonb `Array<{structureId,currentWounds}>`
- `digimon.giganticDimensions` — jsonb nullable `{width,height,depth}`

**Relations:**
- `campaigns` → `tamers`, `digimon`, `encounters`, `evolutionLines`, `maps` (one-to-many via `campaignId`)
- `tamers` → `digimon` (one-to-many via `partnerId`)
- `tamers` → `evolutionLines` (one-to-many via `partnerId`)

---

## 5. Pages & Components
> Last verified: 2026-04-14

**Sources:** `app/pages/**/*.vue`, `app/components/*.vue`, `app/composables/*.ts`, `app/layouts/*.vue`, `app/middleware/*.ts`

### Route Tree (Nuxt file-based routing)

| Path | Component File | Layout | Middleware | Notes |
|---|---|---|---|---|
| `/` | `pages/index.vue` | default | — | Campaign list; password modal |
| `/campaigns/new` | `pages/campaigns/new.vue` | default | — | Create campaign form |
| `/campaigns/[campaignId]` | `pages/campaigns/[campaignId]/index.vue` | default | campaign-access | Campaign hub |
| `/campaigns/[campaignId]/settings` | `pages/campaigns/[campaignId]/settings.vue` | default | dm-access | Campaign rules config |
| `/campaigns/[campaignId]/library` | `pages/campaigns/[campaignId]/library/index.vue` | default | campaign-access | Library landing |
| `/campaigns/[campaignId]/library/digimon` | `.../library/digimon/index.vue` | default | campaign-access | Digimon list |
| `/campaigns/[campaignId]/library/digimon/new` | `.../library/digimon/new.vue` | default | dm-access | Create digimon; uses `DigimonFormPage` |
| `/campaigns/[campaignId]/library/digimon/[id]` | `.../library/digimon/[id].vue` | default | dm-access | Edit digimon; uses `DigimonFormPage` |
| `/campaigns/[campaignId]/library/evolution` | `.../library/evolution/index.vue` | default | campaign-access | Evolution line list |
| `/campaigns/[campaignId]/library/evolution/new` | `.../library/evolution/new.vue` | default | dm-access | Create evolution line |
| `/campaigns/[campaignId]/library/evolution/[id]` | `.../library/evolution/[id].vue` | default | dm-access | Edit evolution line; uses `EvolutionTreeBranch` |
| `/campaigns/[campaignId]/library/tamers` | `.../library/tamers/index.vue` | default | campaign-access | Tamer list |
| `/campaigns/[campaignId]/library/tamers/new` | `.../library/tamers/new.vue` | default | dm-access | Create tamer; uses `TamerFormPage` |
| `/campaigns/[campaignId]/library/tamers/[id]` | `.../library/tamers/[id].vue` | default | dm-access | Edit tamer; uses `TamerFormPage` |
| `/campaigns/[campaignId]/encounters` | `.../encounters/index.vue` | default | campaign-access | Encounter list |
| `/campaigns/[campaignId]/encounters/[id]` | `.../encounters/[id].vue` | default | campaign-access | Full combat view; map toggle shows 3D map when `mapId` set |
| `/campaigns/[campaignId]/library/maps` | `.../library/maps/index.vue` | default | dm-access | Map library list |
| `/campaigns/[campaignId]/library/maps/new` | `.../library/maps/new.vue` | default | dm-access | Create map form |
| `/campaigns/[campaignId]/library/maps/[mapId]` | `.../library/maps/[mapId].vue` | none (layout:false) | dm-access | Full-screen map editor |

#### `app/pages/campaigns/[campaignId]/encounters/[id].vue` — Line Index (4611 lines)

**Script Setup**
| Symbol | Line | Notes |
|--------|------|-------|
| Imports & composables | ~1 | useRoute, useEncounters, useDigimon, useTamers, useEvolution, attack/effect constants |
| UI state refs | ~50 | showSpecialOrdersModal, showAddParticipant, attack selection refs, willpower modal refs |
| GM intercede modal refs | ~85 | showGmIntercedeModal, gmIntercedeRequest, gmIntercedeLoading |
| digimonMap / tamerMap | ~94 | entity lookup maps |
| pendingRequests (computed) | ~169 | CRITICAL — drives pending requests panel |
| getDodgePool() | ~562 | dodge pool calc; adds quickReactionDiceBonus before dodgePenalty subtraction |
| getGmIntercedeOptions() | ~611 | |
| gmIntercedeOffer (computed) | ~646 | finds GM intercede-offer in pendingRequests |
| gmIntercedeQuickReactionRequest (computed) | ~653 | finds player QR-eligible offer in same group |
| confirmAttack() | ~800 | main attack submission; routes to intercede-offer API |
| confirmAreaAttack() | ~894 | multi-target attack |
| cancelIntercedeGroup() | ~988 | cancels all offers in a group |
| handleGmIntercedeClaim() | ~999 | GM steps interceptor in front |
| handleGmIntercedeSkip() | ~1051 | GM skips intercede |
| handleQuickReaction() | ~1067 | player uses QR from pending requests panel |
| handleGmQuickReaction() | ~1085 | GM uses QR from intercede modal |
| handleGmSaveCharacterOptOuts() | ~1109 | |
| requestDodgeRoll() | ~1241 | creates dodge-roll pending request |
| processResponse() | ~1268 | handles responses to pending requests (large function) |
| handleNextTurn() | ~1540 | |
| handleGmDodgeRoll() | ~2229 | GM rolls dodge for NPC/auto |
| handleAddHazard / handleRemoveHazard / handleUpdateHazard | ~2374–2407 | |
| handleInitiateClash / handleClashCheck / executeClashAction / handleBreakClash | ~2440–2507 | |
| onMounted | ~2294 | |

**Template**
| Block | Line | Notes |
|-------|------|-------|
| Combat controls panel | ~2579 | Start/Next Turn/End Combat, Add Participant buttons |
| Turn order list (hierarchicalParticipants loop) | ~2751 | main participant card + partner digimon card |
| — Dodge penalty badge | ~2778 | `v-if="item.participant.dodgePenalty"` |
| — Partner digimon wounds & status | ~2960–3066 | |
| Pending Player Requests section | ~3398 | drives all player-facing request UI |
| — dodge-roll block | ~3446 | handleGmDodgeRoll button |
| — clash-check block | ~3460 | |
| — intercede-offer (player, non-GM) | ~3476 | Quick Reaction button + Cancel Intercede |
| — intercede-offer (GM auto-modal) | ~3422 | comment-only; modal opens via watch on gmIntercedeOffer |
| GM Intercede modal | ~4386 | v-if="showGmIntercedeModal && gmIntercedeRequest" |
| — main view: Intercede / Quick Reaction / Skip / Never Intercede buttons | ~4419–4453 | |
| — select-interceptor view | ~4458 | handleGmIntercedeClaim buttons |
| — select-optout view | ~4491 | per-character never-intercede checkboxes |
| GM Intercede Result modal | ~4550 | showGmIntercedeResultModal |
| Willpower roll modal | ~4273 | showWillpowerRollModal |
| `/campaigns/[campaignId]/player` | `.../player/index.vue` | player | campaign-access | Player hub |
| `/campaigns/[campaignId]/player/new` | `.../player/new.vue` | player | campaign-access | Create player character |
| `/campaigns/[campaignId]/player/[tamerId]` | `.../player/[tamerId].vue` | player | campaign-access | Tamer detail view; End Turn button shown when it's the player's own turn in active combat |
| `/campaigns/[campaignId]/player/[tamerId]/edit` | `.../player/[tamerId]/edit.vue` | player | campaign-access | Edit own tamer |
| `/campaigns/[campaignId]/player/[tamerId]/digimon/new` | `.../player/[tamerId]/digimon/new.vue` | player | campaign-access | Add partner digimon |
| `/campaigns/[campaignId]/player/[tamerId]/digimon/[id]` | `.../player/[tamerId]/digimon/[id].vue` | player | campaign-access | Partner digimon detail |

### Layouts

| Layout | File | Usage |
|---|---|---|
| `default` | `app/layouts/default.vue` | All DM/GM pages; header nav + footer |
| `player` | `app/layouts/player.vue` | Player-facing views; simplified nav |

### Shared Components

| Component | File | Purpose | Key Props |
|---|---|---|---|
| `AttackSelector` | `components/AttackSelector.vue` | Select/manage attacks for a digimon | `attacks`, `stage`, `onUpdate` |
| `DamageCalculator` | `components/DamageCalculator.vue` | UI for rolling and calculating damage | `encounter`, `participant` |
| `DiceRoller` | `components/DiceRoller.vue` | General-purpose dice rolling widget | `label`, `pool`, `onRoll` |
| `DigimonFormPage` | `components/DigimonFormPage.vue` | Full create/edit form for digimon (consolidated from 4 old pages) | `digimonId?`, `campaignId`, `mode` |
| `DigimonMultiSelector` | `components/DigimonMultiSelector.vue` | Multi-select digimon from library | `campaignId`, `selected`, `onUpdate` |
| `DigimonSelector` | `components/DigimonSelector.vue` | Single digimon select | `campaignId`, `value`, `onChange` |
| `EffectManager` | `components/EffectManager.vue` | View/remove active combat effects on participant | `participant`, `encounterId`, `onUpdate` |
| `EvolutionTreeBranch` | `components/EvolutionTreeBranch.vue` | Renders a branch in evolution line tree | `chain`, `branchIndex` |
| `HazardManager` | `components/HazardManager.vue` | Add/remove environmental hazards | `encounterId`, `hazards`, `onUpdate` |
| `QualitySelector` | `components/QualitySelector.vue` | DP-aware quality picker with prerequisites; enforces per-choice rank caps (static `maxRanks` and dynamic caps via props) | `stage`, `currentQualities`, `canAdd`, `availableDP`, `speedyMaxRanks`, `systemBoostMaxRanks`, `eddySoulRules`, `houseRules` |
| `SpritePreview` | `components/SpritePreview.vue` | Display digimon sprite image | `spriteUrl`, `name` |
| `MapCanvas` | `components/MapCanvas.vue` | Three.js 3D isometric renderer; handles billboards, tiles, walls, movement highlights, health overlays, reticules, AOE area highlights (amber tiles in `aoeGroup`); emits `npc-action` (GM NPC radial: Move/Stance/Attack), `player-action` (player radial: Move/Attack), `target-selected` (single-target click), `area-attack-confirmed` (AOE click with covered participant IDs). When `selectedAttack` prop set: shows reticules on valid enemies, renders dynamic AOE preview on mouse move (burst shown immediately), confirms on click | Many props including `selectedAttack: {tags, range, bit, movement?, ram?, sizeAboveLarge?}` |
| `MapToolbar` | `components/MapToolbar.vue` | GM toolbar for map editing (add ground/space, paint, wall/window/door/ceiling/stairs, undo/redo) | `activeTool`, `drawMode`, `elementBrush`, `currentEditY` |
| `MapPropertyPanel` | `components/MapPropertyPanel.vue` | Edit selected structure wound boxes and properties | `selected` |
| `EncounterMap` | `components/EncounterMap.vue` | Container: loads map, connects WebSocket, renders MapCanvas + overlays; uses slots for turn-order and combat-controls; handles `npc-action` move internally, passes through stance/attack; passes through `player-action`, `target-selected`, `area-attack-confirmed` | `encounter`, `isDm`, `myTamerId`, `selectedAttack?`, etc. |
| `MapBattleLog` | `components/MapBattleLog.vue` | Right-side battle log overlay; GM sees full entries, players see NPC stats redacted | `battleLog`, `isDm`, `npcEntityIds` |
| `MapPlayerHUD` | `components/MapPlayerHUD.vue` | Bottom-left tamer + digimon HUD with health bars; minimizable | `participants`, `tamerMap`, `isDm`, `myTamerId` |
| `TamerFormPage` | `components/TamerFormPage.vue` | Full create/edit form for tamers (consolidated) | `tamerId?`, `campaignId`, `mode` |
| `WoundTracker` | `components/WoundTracker.vue` | Visual wound box tracker | `current`, `max`, `onChange` |

### State Management

No Pinia or Vuex. All reactive state lives in **composables** (Vue 3 `ref`/`computed`). Auth state persists via cookies.

**Composables — `app/composables/`:**

| Composable | File | Responsibility |
|---|---|---|
| `useCampaigns` | `useCampaigns.ts` | List, fetch, create, delete campaigns; password verification |
| `useCampaignContext` | `useCampaignContext.ts` | Extract `campaignId` from route; fetch current campaign |
| `useTamers` | `useTamers.ts` | CRUD for tamers; `fetchTamers(campaignId)` |
| `useTamerForm` | `useTamerForm.ts` | Reactive form state for tamer create/edit; derived stats |
| `useTamerValidation` | `useTamerValidation.ts` | Validate tamer data before save; torment rules, skill limits |
| `useDigimon` | `useDigimon.ts` | CRUD for digimon; filtering by campaign/partner |
| `useDigimonForm` | `useDigimonForm.ts` | Reactive form state for digimon create/edit |
| `useDigimonStats` | `useDigimonStats.ts` | Compute derived stats (brains, body, agility, woundBoxes, BIT/CPU/RAM, baseMovement, baseBit/Cpu/Ram for System Boost cap, currentSpeedyMaxRanks) |
| `useDigimonDP` | `useDigimonDP.ts` | DP budget tracking; validate DP allocation |
| `useDigimonAttacks` | `useDigimonAttacks.ts` | Add/edit/remove attacks on digimon form |
| `useDigimonQualities` | `useDigimonQualities.ts` | Add/remove qualities; DP cost calculation |
| `useDigimonValidation` | `useDigimonValidation.ts` | Validate digimon data; stat range enforcement |
| `useEvolution` | `useEvolution.ts` | Evolution line CRUD; advance/devolve stage |
| `useEncounters` | `useEncounters.ts` | Encounter CRUD; all combat action API calls |
| `useMap` | `useMap.ts` | Map CRUD; `fetchMaps`, `fetchMap`, `createMap`, `updateMap`, `deleteMap` |
| `useMapWebSocket` | `useMapWebSocket.ts` | WebSocket client with auto-reconnect (5 retries exp backoff); `send()` + `onMessage()` |
| `useMapMovement` | `useMapMovement.ts` | BFS reachable cells + A* pathfinding; `computeReachable`, `computePath`, `detectCapabilities` |
| `useMapEditor` | `useMapEditor.ts` | Map editing tool state; apply tools, undo/redo stack |
| `useMapRotation` | `useMapRotation.ts` | Per-encounter Y-rotation stored in localStorage |
| `useAttackTags` | `useAttackTags.ts` | Parse attack tag strings; resolve tag effects |
| `useBaseStatRanges` | `useBaseStatRanges.ts` | Min/max base stat lookup per stage |
| `useLibraryImportExport` | `useLibraryImportExport.ts` | Export/import campaign library (tamers, digimon, maps) as JSON |

---

## 6. Dependency Graph
> Last verified: 2026-04-14
> Graph changes: added `computeAttackDamage.ts` (new server util extracted ~Apr 12, imported by `intercede-claim.post` and `resolveNpcAttack`)

**Sources:** All files traced above.

### Top-Level Module Relationships

```mermaid
flowchart TD
    App["app.vue (root)"]
    Layouts["layouts/\ndefault.vue, player.vue"]
    Pages["pages/**\n(25+ routes)"]
    Components["components/\n(14 shared)"]
    Composables["composables/\n(17 shared)"]
    Types["types/index.ts\n(all types + constants)"]
    Data["data/\nqualities, attacks, hazards, special-orders"]
    Utils["utils/\ndisplayHelpers, formDefaults, stanceModifiers, specialOrders, torment-validation, areaShapes"]
    Constants["constants/tamer-skills.ts"]
    Middleware["middleware/\ncampaign-access, dm-access"]
    ServerAPI["server/api/**\n(40+ endpoints)"]
    ServerUtils["server/utils/\napplyEffect, resolveNpcAttack, triggerCounterattack, resolveSupportAttack, resolveAreaIntercedeGroup, computeAttackDamage, parsers, id, password, participantName, mapMovement, gridDistance, areaShapes"]
    DB["server/db/\nindex.ts + schema.ts"]
    Postgres[("PostgreSQL")]

    App --> Layouts --> Pages
    Pages --> Components
    Pages --> Composables
    Components --> Composables
    Composables --> Types
    Composables --> ServerAPI
    Components --> Types
    Components --> Data
    Pages --> Middleware
    Pages --> Utils
    Pages --> Constants
    ServerAPI --> DB
    ServerAPI --> ServerUtils
    ServerAPI --> Types
    ServerUtils --> Types
    ServerUtils --> Data
    DB --> Postgres
```

### Entry Points

| Entry | File | What It Boots |
|---|---|---|
| App shell | `app/app.vue` | Nuxt layout + page system |
| Nitro server | `.output/server/index.mjs` (built) | HTTP server, all `/api/*` routes |
| DB connection | `server/db/index.ts` | PostgreSQL client, imported by every API handler |

### Core Modules (imported by 3+ others)

| Module | Imported By |
|---|---|
| `types/index.ts` | Every composable, component, API handler, server util |
| `server/db/schema.ts` | Every API handler, `server/db/index.ts`, `drizzle.config.ts` |
| `data/qualities.ts` | `QualitySelector`, `useDigimonQualities`, `useDigimonForm`, `server/api/…/actions/*` |
| `data/attacks.ts` | `AttackSelector`, `useDigimonAttacks`, `useAttackTags`, server actions |
| `data/attackConstants.ts` | `useEncounters`, `useAttackTags`, `server/utils/applyEffect`, multiple action handlers |
| `server/utils/applyEffect.ts` | `intercede-offer`, `npc-attack`, `clash-action`, `attack`, `direct`, `special-order` |
| `server/utils/computeAttackDamage.ts` | `intercede-claim.post`, `resolveNpcAttack` |

### Leaf Modules (imported by nothing else)

- `constants/tamer-skills.ts` — only by `TamerFormPage`
- `data/hazards.ts` — only by `HazardManager`
- `data/special-orders.ts` — only by `special-order.post.ts` and `useLibraryImportExport`
- `utils/specialOrders.ts` — by `special-order.post.ts`, `intercede-offer.post.ts`, `quick-reaction.post.ts`
- `utils/torment-validation.ts` — only by `useTamerValidation`
- `server/utils/participantName.ts` — only by server action handlers

### External Service Calls

| Service | Protocol | Module | Notes |
|---|---|---|---|
| PostgreSQL | TCP (postgres driver) | `server/db/index.ts` | Only external dependency |

No HTTP clients, no third-party APIs, no webhooks.

---

## 7. Blast Radius
> Last verified: 2026-04-14
> Rating changes: `computeAttackDamage.ts` (new) → 🟡 MODERATE

**Sources:** Import traces across all source files.

| Module | Direct Dependents | Transitive Reach (≤3 hops) | If changed, check these files | Risk |
|---|---|---|---|---|
| `types/index.ts` | All 17 composables, all 14 components, all 40+ API handlers, all server utils | Entire application | `useDigimonStats.ts`, `applyEffect.ts`, `resolveNpcAttack.ts`, `encounters/[id].vue`, `DigimonFormPage.vue` | 🔴 CRITICAL |
| `server/db/schema.ts` | All 40+ API handlers, `server/db/index.ts` | All composables (via API), all pages | `server/db/index.ts`, `digimon/index.post.ts`, `tamers/index.post.ts`, `encounters/[id].put.ts`, `campaigns/[id].put.ts` | 🔴 CRITICAL |
| `server/db/index.ts` | All 40+ API handlers | All composables (via fetch), all pages | `attack.post.ts`, `npc-attack.post.ts`, `digimon/[id].put.ts`, `campaigns/[id].put.ts` | 🔴 CRITICAL |
| `data/attackConstants.ts` | `useEncounters`, `useAttackTags`, `applyEffect`, `attack.post`, `intercede-offer.post`, `npc-attack.post`, `clash-action.post` | All encounter pages, all combat UI | `applyEffect.ts`, `attack.post.ts`, `intercede-offer.post.ts`, `npc-attack.post.ts`, `useAttackTags.ts` | 🔴 CRITICAL |
| `data/qualities.ts` | `QualitySelector`, `useDigimonQualities`, `useDigimonForm`, `digivolve.post`, `special-order.post`, `attack.post` | DigimonFormPage, all library/digimon pages, all encounter pages | `QualitySelector.vue`, `useDigimonQualities.ts`, `attack.post.ts`, `digivolve.post.ts`, `resolveSupportAttack.ts` | 🔴 CRITICAL |
| `server/utils/applyEffect.ts` | `attack.post`, `intercede-offer.post`, `npc-attack.post`, `clash-action.post`, `direct.post`, `special-order.post` | All encounter pages | `attack.post.ts`, `intercede-offer.post.ts`, `npc-attack.post.ts`, `clash-action.post.ts`, `direct.post.ts` | 🔴 CRITICAL |
| `server/utils/computeAttackDamage.ts` | `intercede-claim.post`, `resolveNpcAttack` | All encounter pages (via intercede and NPC attack flows) | `intercede-claim.post.ts`, `resolveNpcAttack.ts`, encounter pages | 🟡 MODERATE |
| `server/utils/resolveNpcAttack.ts` | `intercede-offer.post`, `npc-attack.post`, `clash-action.post`, `triggerCounterattack` | All encounter pages | `intercede-offer.post.ts`, `npc-attack.post.ts`, `clash-action.post.ts`, `triggerCounterattack.ts` | 🔴 CRITICAL |
| `composables/useEncounters.ts` | `encounters/[id].vue` (combat page), indirectly via sub-composables | All encounter-related UI | `encounters/[id].vue`, `player/[tamerId]/index.vue` | 🔴 CRITICAL |
| `server/utils/triggerCounterattack.ts` | `attack.post`, `intercede-offer.post` | Encounter pages | `attack.post.ts`, `intercede-offer.post.ts` | 🟡 MODERATE |
| `data/attacks.ts` | `AttackSelector`, `useDigimonAttacks`, `useAttackTags` | DigimonFormPage, encounter pages | `AttackSelector.vue`, `useDigimonAttacks.ts`, `useAttackTags.ts` | 🟡 MODERATE |
| `composables/useDigimonForm.ts` | `DigimonFormPage` | Library digimon pages (new, edit) | `DigimonFormPage.vue`, `library/digimon/new.vue`, `library/digimon/[id].vue` | 🟡 MODERATE |
| `composables/useTamerForm.ts` | `TamerFormPage` | Library tamer pages (new, edit) | `TamerFormPage.vue`, `library/tamers/new.vue`, `library/tamers/[id].vue` | 🟡 MODERATE |
| `components/DigimonFormPage.vue` | `library/digimon/new.vue`, `library/digimon/[id].vue` | 2 pages | `library/digimon/new.vue`, `library/digimon/[id].vue` | 🟡 MODERATE |
| `components/TamerFormPage.vue` | `library/tamers/new.vue`, `library/tamers/[id].vue` | 2 pages | `library/tamers/new.vue`, `library/tamers/[id].vue` | 🟡 MODERATE |
| `utils/formDefaults.ts` | `useDigimonForm`, `DigimonFormPage` | Library digimon pages | `useDigimonForm.ts`, `DigimonFormPage.vue` | 🟡 MODERATE |
| `composables/useEvolution.ts` | `library/evolution/[id].vue`, `digivolve.post` | 1 page | `library/evolution/[id].vue`, `digivolve.post.ts` | 🟡 MODERATE |
| `middleware/campaign-access.ts` | All `[campaignId]` routes | All campaign pages | `campaigns/[campaignId]/index.vue`, `encounters/[id].vue`, `player/[tamerId]/index.vue` | 🟡 MODERATE |
| `middleware/dm-access.ts` | Settings, new/edit library pages | ~8 pages | `campaigns/[campaignId]/settings.vue`, `library/digimon/new.vue`, `library/tamers/new.vue` | 🟡 MODERATE |
| `constants/tamer-skills.ts` | `TamerFormPage` only | 2 pages | `TamerFormPage.vue` | 🟢 LOW |
| `data/hazards.ts` | `HazardManager` only | 1 component, encounter page | `HazardManager.vue` | 🟢 LOW |
| `utils/torment-validation.ts` | `useTamerValidation` only | TamerFormPage | `useTamerValidation.ts`, `TamerFormPage.vue` | 🟢 LOW |
| `server/utils/participantName.ts` | Several action handlers | Encounter pages (via log entries) | `attack.post.ts`, `npc-attack.post.ts`, `intercede-offer.post.ts` | 🟢 LOW |
| `server/utils/id.ts` | Several API handlers (ID gen) | — | `digimon/index.post.ts`, `tamers/index.post.ts`, `campaigns/index.post.ts` | 🟢 LOW |

---

## 8. Cross-Cutting Concerns
> Last verified: 2026-04-14

**Sources:** `middleware/campaign-access.ts`, `middleware/dm-access.ts`, `server/utils/password.ts`, `server/api/campaigns/[id]/verify-password.post.ts`, `nuxt.config.ts`

### Auth Flow

- **Strategy:** Cookie-based (no JWT, no OAuth, no sessions table)
- **Player access:** Cookie `campaign-access-{campaignId}` — set after `POST /api/campaigns/[id]/verify-password` succeeds
- **DM access:** Cookie `campaign-dm-{campaignId}` — set after `POST /api/campaigns/[id]/verify-dm-password` succeeds
- **Enforcement:** Client middleware in `middleware/campaign-access.ts` and `middleware/dm-access.ts` — reads cookies and redirects if missing
- **Password storage:** bcrypt hashed in `campaigns.passwordHash` / `campaigns.dmPasswordHash` via `server/utils/password.ts`
- **No server-side session validation** on API routes — API is fully open if hit directly; security relies on client enforcement

### Error Handling

- API handlers use Nuxt's `createError({statusCode, statusMessage})` / `throw createError(...)` pattern
- No global error page configured beyond Nuxt defaults
- Client-side errors surfaced via composable `error` refs (e.g., `const error = ref<string | null>(null)`)
- No error reporting service (no Sentry, etc.)

### Logging & Observability

- No structured logger (no winston, pino, etc.)
- Combat history is recorded in `encounters.battleLog` (persistent per-encounter action log)
- `console.log` / `console.error` only for development debugging

### Testing Strategy

- **No test framework configured** — no vitest, jest, or playwright config detected
- No test files found anywhere in the repository
- No coverage tooling

### CI/CD Pipeline

- **No CI/CD pipeline detected** — no `.github/workflows/`, no `.gitlab-ci.yml`, no `Dockerfile`, no `docker-compose.yml`
- Deployment is manual (likely direct push to Railway based on `DATABASE_URL` pattern)

### Feature Flags

- **EddySoul house rules** (`EddySoulRules` in `types/index.ts`): toggleable rule variants stored in `campaigns.rulesSettings.eddySoulRules` — controls accuracy/damage/armor remapping, charge cost, digivolution limit (5/day), warp evolution, enemy double wounds, etc.
- **House rules** (`HouseRules`): 6 toggles — stun max duration, max temp wounds, signature move battery, healing rules, allow duplicate stat max values (tamer creation), flexible CP splits (tamer creation)
- **Torment requirements** (`TormentRequirements`): Mode + minimum severity counts
- **Skill renames** (`SkillRenames`): Per-campaign renaming of tamer skill labels
- **Skill Orders** (`rulesSettings.skillOrders: boolean`): Homebrew. When enabled, each tamer skill unlocks a Skill Option once the skill hits its threshold (4/5/6) and the governing attribute has its first Special Order (3/5/6). Surfaced on tamer sheets + an in-combat action panel via `skill-order` endpoint.
- All flags read from `campaign.rulesSettings` passed into composables and server action handlers; no external flag service

---

## 9. Quick Reference
> Last verified: 2026-04-14

### How to Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Set env var (create .env.local)
echo "DATABASE_URL=postgresql://user:pass@host/db" > .env.local

# 3. Apply migrations
npm run db:migrate

# 4. Start dev server
npm run dev
# → http://localhost:3000
```

### How to Run Tests

No tests configured. N/A.

### How to Deploy

```bash
npm run build
# Outputs to .output/server/index.mjs

node .output/server/index.mjs
# Requires DATABASE_URL in environment
```

### How to Inspect the Database

```bash
npm run db:studio
# Opens Drizzle Studio web UI connected to DATABASE_URL
```

### Key Files to Read First (Onboarding Order)

1. [types/index.ts](app/types/index.ts) — All types, enums, rule constants (STAGE_CONFIG, BASE_STAT_RANGES, etc.). Read this first.
2. [server/db/schema.ts](app/server/db/schema.ts) — Exact database shape for all 5 tables.
3. [data/qualities.ts](app/data/qualities.ts) — Quality system (DDA 1.4 rules §3.03–3.16); critical for DP and combat.
4. [data/attackConstants.ts](app/data/attackConstants.ts) — Attack tag definitions; used everywhere in combat.
5. [server/utils/applyEffect.ts](app/server/utils/applyEffect.ts) — Effect stacking/mutation rules.
6. [server/utils/resolveNpcAttack.ts](app/server/utils/resolveNpcAttack.ts) — Full server-side attack resolution; the most complex combat logic.
7. [server/api/encounters/[id]/actions/attack.post.ts](app/server/api/encounters/[id]/actions/attack.post.ts) — Player attack flow; traces through intercede, bolster, counterattack.
8. [composables/useEncounters.ts](app/composables/useEncounters.ts) — Client-side encounter state and all combat action API calls.

### Domain Glossary (DDA 1.4 TTRPG Terms)

| Term | Meaning |
|---|---|
| Wounds | HP/health damage (not called HP in this system) |
| DP | Digimon Points — build budget for qualities and stat bonuses |
| Bolster | Spend extra action for +2 accuracy or alternative stat bonus |
| Clash | Grapple mechanic — controller vs controlled |
| Digivolve/Devolve | Evolve to higher/lower form in combat |
| Warp Evolution | Skip stages during digivolution (requires Willpower DC) |
| EddySoul | Homebrew rule variant set for DDA 1.4 |
| Special Order | Tamer combat ability unlocked by attribute scores |
| Battery | Signature Move resource (charges per stage) |
| Positive Reinforcement | Quality giving tamer a mood meter (1–6) for digimon |
| Combat Monster | Quality that accumulates bonus damage each round |
| Counterattack | Quality that lets digimon auto-attack when opponent misses |
| Data Optimization | Quality that boosts one specific stat |
