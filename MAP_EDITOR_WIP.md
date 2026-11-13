# Map editor work in progress

Checkpoint: 2026-11-13. User requested stopping implementation, recording unfinished work, and pushing this checkpoint to resume later. This is unfinished work, not a release-ready editor.

## Requested behaviour

- Keep existing Y-clip; it already covers height isolation.
- Hold Space and drag to pan, then resume the current building tool.
- Build against pointed surfaces, with an optional fixed Y plane.
- Select areas and move, rotate, duplicate, or delete their contents atomically.
- Save and place rotated reusable stamps.
- Adjustable brushes, circles, and continuous painting alongside line/rectangle/box modes.
- Material eyedropper.
- Fit map, focus selection, top-down, and four isometric corner views.
- Cursor feedback with tool, coordinates, drag dimensions, and invalid-placement explanations.
- Room creation with configurable wall height, optional material floor, and doors/windows on wall edges.
- Place floors with the selected material immediately, like voxels.
- Replace the bright floor-material seam overlay with natural material blending, and apply it to voxels too.
- Reorganise all tools. Explicit air is largely redundant on endless maps; retain legacy compatibility and put volumes in advanced controls.

## Draft implementation included

- `app/components/MapToolbar.vue`: grouped Navigate & select / Build / Finish controls, advanced Volumes, contextual brush/material/room options, selection transforms, stamp controls, undo/redo.
- `app/components/MapCanvas.vue`: Space pan state, surface picking and plane lock, selection outline, stroke preview, cursor feedback, room/stamp preview, camera actions, wall-edge picking from actual geometry, blur/mouse-up handling.
- `app/components/EncounterMap.vue`: connects tools and camera actions to editor operations and existing autosave.
- `app/composables/useMapEditor.ts`: one-operation brush strokes, room creation, selection capture/transforms/deletion, stamps, material sampling, material-aware floor placement and painting.
- `app/utils/mapBuilder.ts`: shared drawing cells, selection bounds, fragment capture/transforms, linked structure remapping and collision checking.
- `app/utils/terrainMaterialBlend.ts`: draft procedural, lighting-aware surface blend shader using a per-instance neighbour-colour palette. Replaces unlit overlay planes while retaining instanced draw batches.
- `app/utils/mapTerrainChunks.ts`: material-aware floor colours; neighbour palettes for floors and opaque voxels; palette/resource cleanup.
- Optional `materialId` added to floor JSON types in `app/types/index.ts` and `app/server/db/schema.ts`. No new database migration is required for that optional JSON property. Existing maps retain their geometry.
- Stamps currently persist in browser localStorage under `dda-map-stamps-v1`; they are reusable across maps in that browser, not synced to accounts/devices.

## Verification at checkpoint

Latest focused run: **110 tests, 109 passing, 1 failing**.

Failing test: `app/tests/stairEditor.test.mjs`, ?the stair toolbar shows drawing modes, selected uphill direction and scrolling hint?. It expects `<option value="west" selected` in SSR markup. The toolbar now uses v-model on the editor's direction ref, and the rendered markup does not contain that selected attribute. Determine whether the client binding works, then fix either the binding or the test's SSR assumption. Do not simply drop direction coverage.

Other focused tests passed, including atomic edits, floor materials, brush interpolation and undo, room creation, selection transforms and collisions, stamp persistence, surface picking, Space pan state, rendering batches, movement interactions, ramp geometry/scrolling, and autosave integration.

Command (from `app`; PowerShell may require `node` worker permissions):

```powershell
node --import ./scripts/offline-env.mjs --test tests/mapBuilder.test.mjs tests/atomicMapEditor.test.mjs tests/mapSaveIntegration.test.mjs tests/mapFrameScheduling.test.mjs tests/mapInteraction.test.mjs tests/mapTerrainChunks.test.mjs tests/rampGeometry.test.mjs tests/rampScroll.test.mjs tests/stairEditor.test.mjs
npm.cmd run typecheck
```

Full typecheck still reports pre-existing application errors (implicit-any/untyped refs in map/combat/player components). Re-run after finishing and compare against the prior baseline; do not assume all errors are pre-existing. Earlier component compilation checks passed, but recompile the final checkpoint after further edits.

Local ignored diagnostic logs: `app/builder-tests.log` and `app/builder-typecheck.log`. They are not committed; the reproducible summary is recorded here.

## Unfinished / next steps

1. Resolve the one failing stair-toolbar test and verify direction selection in a real browser. Add browser/DOM coverage for the ref-based contextual toolbar controls.
2. Run the application and exercise every new tool end to end. No browser or GPU visual verification has been completed. Check toolbar wrapping and viewport height on narrow screens, pointer feedback placement, keyboard focus, and selection actions.
3. Verify Space pan on press/release during a drag, release outside the canvas, blur, and tool changes. Ensure it never paints, changes the selected tool, or interferes with participant dragging or text inputs. Zoom should remain available while building.
4. Finish surface placement checks for top/side/bottom faces, ramps, floor height, empty-space fallback, and plane-locked drags. Check room wall edges at upper levels when adding doors/windows.
5. Check continuous brush behaviour with fast/coalesced pointer events, large brush sizes and long strokes. It currently previews a trail and commits one undoable operation on release; verify this feels continuous enough. Check cancellation and preview/commit parity for circles and 3D boxes.
6. Harden and polish selection/stamp controls: validate integer offsets and dimensions, audit rotation/anchor semantics and collision messages, preview transformed selections, handle malformed stored stamp data and storage failures, and test transforms across chunk boundaries. Confirm any coordinate/ID/door-state properties survive save/import/undo.
7. Complete and visually validate the new material blend. The shader/palette integration is a draft, not visually approved. Verify actual GLSL compilation, lighting, seam continuity, colour space, noise scale, and both floor and voxel surfaces, including ramps and chunk boundaries. Add direct voxel blend tests.
8. Transparent voxels currently use a separate BatchedMesh path and do **not** receive the new blend palette. Decide how to blend appropriate translucent materials while preserving opacity, depth sorting, light sources, and crisp gameplay features such as windows. Do not claim blending covers all voxel types yet.
9. Verify GPU resource lifecycle and performance on large mixed-material maps. Current homogeneous-map batching regression tests pass; mixed-material shader/palette cost still needs profiling. Include repeated paint/delete/undo and map switching.
10. Review new code formatting/readability and remove obsolete blend API/comments or unused scaffolding. Re-run typecheck, component compilation, relevant security/import/save tests, and then the full test suite. Update `PROJECT_MAP.md` when the final design is settled.

## Previously completed context

Before this WIP, main already included endless map creation with no width/depth fields or generated floor by default; cached display bounds including negative coordinates; fitted isometric starting camera; shared Workshop loading and matching map cards. The existing `0027_add_map_content_bounds.sql` migration only adds the metadata column and intentionally does not backfill old maps. Old maps initialise bounds on their next in-app save. Do not reintroduce a bulk update of existing maps.
