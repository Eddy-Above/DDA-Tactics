# Future Plan: Convert JSON-ish TEXT columns to native `jsonb`

## Context

`server/db/schema.ts` declares 34 columns across 6 tables using
`text('col', { mode: 'json' }).$type<{...}>()`. `mode: 'json'` is a
**SQLite-only** Drizzle option and is silently ignored by
`drizzle-orm/pg-core`'s `text()` — the actual Postgres columns are plain
`TEXT`, and every server route manually `JSON.stringify()`s before insert/
update and `JSON.parse()`s (often via `parseJsonField`-style helpers) after
select.

This produces a **type duality**: the schema-inferred types (`Tamer`,
`Digimon`, `Encounter`, `Campaign`, `EvolutionLine`, `Map`) are imported both
by:
- server DB-access code, where these columns are raw `string` at runtime
  (pre-parse), and
- client composables/components (e.g. `useDigimon.ts`), where the same type
  names represent the parsed API response shape (objects/arrays).

Because of this, neither `$type<{...}>()` (current, technically wrong for the
DB layer) nor `$type<string>()` (technically correct for the DB layer, but
breaks every client-side consumer) is a clean fix. An empirical test
(2026 session) confirmed switching just `digimon.baseStats` to
`$type<string>()` increased total `vue-tsc` errors from 328 → 348 for that
one column alone.

The architecturally correct fix is to make the **database** match the
client-side assumption: store these columns as native Postgres `jsonb`, let
Drizzle return parsed objects/arrays directly, and delete the manual
`JSON.parse`/`JSON.stringify` calls. This eliminates the duality entirely —
both server and client get the same parsed-object types, matching what
`$type<{...}>()` already (optimistically) declares today.

## Scope

### 1. Schema changes (`server/db/schema.ts`)

Convert all 34 columns from:
```ts
someCol: text('some_col', { mode: 'json' }).notNull().$type<{...}>()
```
to:
```ts
someCol: jsonb('some_col').notNull().$type<{...}>()
```
(`jsonb` import already exists in schema.ts but is currently unused.)

Columns by table:
- **`tamers`** (9): `attributes`, `skills`, `aspects`, `torments`,
  `specialOrders`, `xpBonuses`, `equipment`, `usedPerDayOrders`,
  `usedPerDaySkillOrders`
- **`digimon`** (6): `baseStats`, `attacks`, `qualities`, `bonusStats`,
  `evolutionPathIds`, `giganticDimensions`
- **`encounters`** (8): `participants`, `turnOrder`, `battleLog`, `hazards`,
  `pendingRequests`, `requestResponses`, `participantPositions`,
  `destructibleStates`
- **`campaigns`** (1): `rulesSettings`
- **`evolutionLines`** (1): `chain`
- **`maps`** (9): `dimensions`, `groundTiles`, `spaceTiles`, `voxels`,
  `walls`, `windows`, `doors`, `ceilings`, `stairs`

Columns with a `.default('...')` (e.g. `xpBonuses`, `bonusStats`,
`usedPerDayOrders`, `pendingRequests`, `participantPositions`,
`destructibleStates`, `rulesSettings`, `groundTiles`, `spaceTiles`, `voxels`,
`walls`, `windows`, `doors`, `ceilings`, `stairs`) need their default literal
re-checked — Drizzle's `jsonb()` accepts a JS value (object/array) for
`.default()` directly rather than a JSON string literal, so e.g.
`.default('[]')` becomes `.default([])` and `.default('{}')` becomes
`.default({})`.

### 2. Database migration

A new Drizzle migration (`0013_...sql`, generated via `drizzle-kit generate`
after the schema edit) that, for each of the 34 columns, runs:
```sql
ALTER TABLE "<table>" ALTER COLUMN "<col>" TYPE jsonb USING "<col>"::jsonb;
```
Postgres can cast `TEXT` containing valid JSON to `jsonb` directly via
`USING ... ::jsonb`, so this is a single-pass, in-place conversion — no
temp columns or backfill scripts needed, **provided every existing row
currently contains valid JSON** in these columns (spot-check
production/staging data first; any empty-string or malformed values would
fail the cast and need a `COALESCE`/cleanup pass beforehand, e.g.
`USING NULLIF("<col>", '')::jsonb` or a `CASE` for not-null columns).

Also drop any `DEFAULT '...'` string defaults and re-add as `jsonb` defaults
matching the new schema (`ALTER COLUMN ... SET DEFAULT '[]'::jsonb`, etc.).

### 3. Remove manual (de)serialization in server routes

`grep -rn "JSON.parse\|JSON.stringify" app/server/` currently returns ~478
matches across ~55 files. Not all of these touch the 34 schema columns above
(some are for in-memory objects, logging, websocket payloads, etc.), so the
actual cleanup scope is smaller but needs a per-file audit. Expect the bulk
of the work in:
- `server/utils/parsers.ts` (`parseTamerData`, `parseDigimonData`,
  `parseJsonField`-style helpers) — likely deletable or greatly simplified
  once Drizzle returns parsed values directly.
- All `POST`/`PUT`/`PATCH` routes under `server/api/tamers/`,
  `server/api/digimon/`, `server/api/encounters/[id]/actions/`,
  `server/api/campaigns/`, `server/api/evolution-lines/`, `server/api/maps/`
  that currently build `JSON.stringify(...)` payloads for insert/update.
- All `GET` routes / response-shaping code that currently calls
  `JSON.parse(...)` on these fields after `db.select()`.

### 4. Type cleanup

Once columns are `jsonb` with `$type<{...}>()`, `$inferSelect`/`$inferInsert`
types (`Tamer`, `Digimon`, `Encounter`, `Campaign`, `EvolutionLine`, `Map`)
will correctly represent parsed objects on **both** server and client without
contradiction — this is what should make the bulk of the original ~328
`vue-tsc` errors (the schema-cascade ones, e.g. "string not assignable to
{...}[]" in clash-action/responses.post/npc-attack etc.) disappear without
per-call-site `as` casts.

## Suggested order of operations

1. Audit existing data for non-JSON / empty-string values in the 34 columns
   (one-off SQL query per column, or a script) — fix/clean any bad rows
   before the type-change migration.
2. Update `schema.ts`: switch all 34 columns to `jsonb()`, fix `.default()`
   literals, remove now-unused imports if any.
3. Generate + review the `ALTER COLUMN ... TYPE jsonb USING ...::jsonb`
   migration; run against a local/staging copy first.
4. Run `npx vue-tsc --noEmit` — expect a large drop in error count; this will
   surface every call site that still does manual `JSON.parse`/
   `JSON.stringify` against these fields (now type errors: "Argument of type
   '{...}' is not assignable to parameter of type 'string'" and similar).
5. Work through those call sites file-by-file, removing the manual
   (de)serialization and the now-redundant `parsers.ts` helpers.
6. Re-run `vue-tsc` + `npm run build` + manual smoke test (create/edit
   tamer & digimon, run an encounter round with NPC attacks, save a map) to
   confirm parity.
7. Update `PROJECT_MAP.md` Data Models & Storage section to describe the new
   `jsonb` columns and the removal of manual JSON (de)serialization, per
   CLAUDE.md.

## Why this is a separate effort

This touches all 6 tables, requires a real (if low-risk) production schema
migration, and cascades into ~50 server files for the (de)serialization
cleanup — far larger than the Sections 2-9 type-narrowing fixes done
alongside this plan. It should be scheduled as its own project with its own
testing pass on a staging database before being applied to production.
