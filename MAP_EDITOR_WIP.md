# Map editor completion record

Completed: 2026-11-13. This replaces the unfinished checkpoint from the same date.

## Implemented behaviour

- Grouped navigation, selection, building, finishing, history, and advanced volume controls. Legacy air volumes remain compatible with existing maps.
- Hold Space and drag to pan without changing the building tool. Editing gestures cancel on Escape, blur, pointer cancellation, tool changes, map changes, or release outside the canvas. Space ignores form controls and active participant drags. Zoom remains available while building; ramp/stair scrolling rotates uphill direction.
- Surface placement follows block and ramp normals and elevated floor surfaces, including side and underside hits. Optional fixed Y placement remains available. Paint, erase, spawn, and material sampling use the pointed cell independently of a hidden placement lock.
- Line, rectangle, circle, box, and adjustable square/round brush tools. Every brush bend is retained before frame coalescing, preview cells update incrementally, and a complete stroke is one undoable edit.
- Rooms have configurable wall heights and optional floors in the selected material. Doors/windows pick actual wall geometry, including upper room levels.
- Area selection supports all-height capture, move/rotate previews, atomic move, duplication, deletion, and camera focus. Moves preserve structure IDs; copies/stamps create fresh IDs and remap linked doors/windows. Door state and other geometry metadata survive transforms, JSON saves, and undo/redo. An unchanged move creates no history entry.
- Rotated reusable stamps persist under `dda-map-stamps-v1` in browser localStorage. Library loading validates integer coordinates, faces, materials, optional voxel properties, IDs, and linked walls; damaged entries are skipped. Storage failures preserve the session library and show feedback.
- Selected materials apply immediately to new floors. Floor and voxel painting preserve full material identity. Integer validation and a 100,000-cell operation limit prevent malformed or excessive edits. Previews show up to 1,000 meshes plus bounds for larger content.
- Fit map, focus selection, top-down, and four isometric corner views. Cursor feedback includes coordinates, dimensions, and invalid-input/collision explanations. Distance fog is visibly restored on normal maps and scales with large fitted views.
- Natural, linear-colour material transitions run inside the lit Lambert shader for floors, opaque blocks/ramps, and appropriate translucent terrain. Translucent RGB blending preserves alpha and global BatchedMesh depth sorting. Glass, windows, and light sources retain crisp colours. Palettes use stable batch IDs, work with and without multi-draw, and release resources on rebuild/disposal.

## Campaign map list correction

The campaign map list now uses keyed `useAsyncData` and `useRequestFetch`. The server forwards the incoming viewer session and the browser hydrates the same map payload instead of fetching a different initial list. Initial failures show an error rather than an empty-list layout. Browser verification confirms the same card content and three-column desktop grid after client navigation and SSR hydration on reload, with no hydration errors.

## Verification

- Full application suite: **1,547 tests passing**, no failures.
- Production Nuxt build: passes; final Vue components and server bundle compile.
- Actual-component Chrome checks: toolbar bindings in both directions, floor/voxel/shape tools, brushes, rooms, upper wall openings, selections/stamps, paint/sampling, spawn/erase, history, camera views, focus behaviour, Space pan, cancellation, narrow layouts, shaders, fog, and map switching.
- Both `WEBGL_multi_draw` and its fallback: pass, including translucent shaders and campaign map-list hydration. The fallback fixture deliberately withholds that extension before creating the renderer.
- Repeated paint/undo/redo and map switching return to the same GPU geometry/texture counts. CPU benchmarks include homogeneous and mixed maps up to 62,500 cells, repeated edits/restoration, and disposal assertions. The mixed 62,500-cell fixture uses 1,333 terrain batches; the 12,500-cell browser fixture uses 279 calls with multi-draw and 1,778 without it.
- Full typecheck still reports **91 existing diagnostics**, all in unchanged combat/player/form/context files. No new diagnostic signatures versus the comparison log, and none in the changed editor, renderer, or campaign map-list files. This is not an application-wide typecheck pass.
- Browser GPU verification uses Chrome SwiftShader. Physical GPU performance and authenticated production services were not exercised. No production database writes or bulk bounds updates were performed. Runtime used for these local checks: Node 22.14.0; deployment's declared target remains Node 24.

Reproduce from `app`:

```powershell
node --import ./scripts/offline-env.mjs --test
npm.cmd run build
npm.cmd run typecheck
node --import ./scripts/offline-env.mjs scripts/verify-map-editor-browser.mjs
$env:DDA_MAP_NO_MULTI_DRAW='1'
node --import ./scripts/offline-env.mjs scripts/verify-map-editor-browser.mjs
Remove-Item Env:DDA_MAP_NO_MULTI_DRAW
node --import ./scripts/offline-env.mjs scripts/benchmark-map-terrain.mjs
```

The browser script compiles actual editor and map-list components into a temporary fixture, supplies local map data and a Nuxt-style hydration payload, starts an isolated browser profile, and cleans up its temporary files. It does not contact application APIs. Camera/renderer probes are injected only into that fixture build. Screenshots and JSON reports are written to ignored `.cache/map-editor-verification/native/` and `fallback/`. Diagnostic test/build/typecheck logs are also ignored; this file records the reproducible results.

## Persistence and compatibility

Stamps are reusable across maps in the same browser; they are not account/device synced. Floor `materialId` is an optional JSON property and needs no database migration. Existing map geometry is retained. The existing `0027_add_map_content_bounds.sql` migration only adds metadata; old maps initialise bounds on their next in-app save. Do not bulk-backfill old maps or reintroduce fixed width/depth boundaries.
