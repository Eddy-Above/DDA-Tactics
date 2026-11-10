# Dependency audit — 10 November 2026

The final online audit reports **zero critical and zero high findings**. Moderate findings remain, including Nuxt 3 advisories that require migration to a supported major release for upstream fixes. Application guards reduce specific exposure; they do not patch the framework.

## Final verification snapshot

| Check | Final result |
| --- | --- |
| `npm audit --json` | 15 affected package nodes: 13 moderate, 2 low |
| `npm audit --omit=dev --json` | 11 affected package nodes: 9 moderate, 2 low |
| Critical / high | 0 / 0 in both audits |
| Locked versions | Nuxt 3.21.11, Vue 3.5.45, Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, Nuxt Security 2.7.0, Vue TSC 3.3.14 |
| Offline verification | 1,484 tests, TypeScript checks and the production build passed on Node 24 |

Audit evidence is in `app/.security-audit-all.log` and `app/.security-audit-runtime.log`. Counts describe package nodes, including parents flagged through vulnerable children, rather than independent exploitable vulnerabilities. The final lockfile SHA-256 is `148dc7aa0980af1120a72e0f9b1ea9c17a6f069acf35774e599ca2d4e3bbe24d`.

The unused direct Nuxt DevTools dependency was removed. Drizzle Kit is now a development dependency. Updating Vue TSC removed its obsolete vulnerable language-tooling chain. Compatible dependencies were refreshed without running database migrations or connecting verification to production.


The baseline fresh audit had 54 affected package entries (5 critical, 24 high, 21 moderate, 4 low). Reproduce the final online checks with `npm audit --json --offline=false --prefer-online --registry=https://registry.npmjs.org` and the same command with `--omit=dev`; local evidence logs are intentionally ignored by Git. Project schema typings are pinned to Nuxt 3.21.11 to avoid a Nuxt 4 tooling type collision; the CLI reports an optional schema-peer warning. Locked install resolution, type checking, the final build and browser checks succeeded on Node 24.

## What is actually deployed

The Docker build installs the source dependency graph, but its final non-root Node 24 Alpine stage copies **only `.output`** and starts `.output/server/index.mjs`. It does not deploy the source checkout, top-level `node_modules`, Drizzle CLI, development servers or operator scripts.

The final `.output/server/package.json` lists 29 external packages, including Vue 3.5.45 and Drizzle ORM 0.45.4. None of the 15 audit-flagged package names appears in that external manifest. Inspected output also contains no identified glob, minimatch, archiver, deepmerge or old esbuild-loader package imports.

This does **not** establish a clean runtime audit: Nuxt/Nitro runtime code is bundled into `.output/server/chunks/_/nitro.mjs` and `chunks/routes/renderer.mjs`, and client code is emitted into `.output/public/_nuxt`. Nuxt advisories must therefore be assessed by their execution prerequisites even when `nuxt` is absent from the external manifest. Conversely, `--omit=dev` still counts Nuxt's build tooling because Nuxt is a production dependency in the source manifest; those 11 nodes are not an inventory of the final container.

Installed Nitro is 2.13.6. Its upstream `dist/meta/index.mjs` embeds the older version string `2.13.5`, which is also written into `.output/nitro.json`; the final build log identifies 2.13.6. This metadata discrepancy was checked against the installed package rather than treated as a stale build.

## Remaining advisory paths and exposure

| Advisory / dependency path | Prerequisites and assessment for this app |
| --- | --- |
| [Nuxt route-rule case bypass — GHSA-vjh5-4x84-xrqp](https://github.com/nuxt/nuxt/security/advisories/GHSA-vjh5-4x84-xrqp); `nuxt → @nuxt/nitro-server` | Requires protections based on case-sensitive server route rules while pages route without case sensitivity. Campaign/entity authorization is checked in server handlers, unsafe-request Origin checks run globally, and rate classifications handle case variants. These controls do not depend on redirect/header route rules. The affected framework remains installed. |
| [Server-island head sanitization — GHSA-xfq5-w38q-pc2x](https://github.com/nuxt/nuxt/security/advisories/GHSA-xfq5-w38q-pc2x); `nuxt` | Requires attacker-controlled `useHeadSafe` input inside a server island. Source inspection found no `useHeadSafe`, `.server.vue`, `<NuxtIsland>` or enabled component-islands usage. This prerequisite is absent in current application code. |
| [NuxtLink protocol handling — GHSA-jjm6-p2m9-9w4x](https://github.com/nuxt/nuxt/security/advisories/GHSA-jjm6-p2m9-9w4x); `nuxt` | Requires pages disabled, an untrusted link destination and a victim click. This app has a pages directory and Vue Router; the advisory explicitly excludes applications using Vue Router. |
| [Development bundle disclosure — GHSA-648h-gw55-m2g7](https://github.com/nuxt/nuxt/security/advisories/GHSA-648h-gw55-m2g7); `nuxt → @nuxt/vite-builder` | Requires HTTP access to a Nuxt development server and private runtime configuration embedded in its generated dev bundle. The final image runs the production output, not `nuxt dev`. Keep development servers private and rotate any affected runtime-config secrets if one was previously exposed. |
| [esbuild development-server CORS — GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99); `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild@0.18.20` | Requires the affected esbuild serving API to be running and a malicious site able to query it through the developer's browser. This nested copy is a development-tool dependency; it is absent from the final external runtime packages and no app serving path was identified. Patched esbuild copies elsewhere do not remove this nested finding. |
| [glob cancellation — GHSA-3g3m-2fjr-6pw4](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch amplification — GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249); `nuxt → @nuxt/nitro-server → nitropack → @vercel/nft → glob@13.0.7 → minimatch@10.2.6`, also `nitropack → archiver → readdir-glob → minimatch` | glob can continue walking after cancellation; minimatch requires attacker-controlled patterns with optimization level at least 2. Here these paths perform build tracing/archiving. No application HTTP handler accepts glob patterns or imports these tools, and the identified packages are absent from the output manifest. Build untrusted source trees in an isolated environment. |
| [deepmerge report — GHSA-gcqx-w48m-w2h4](https://github.com/TehShrike/deepmerge/issues/273); `nitropack → @rollup/plugin-node-resolve → deepmerge@4.3.1` | The raw npm audit still flags deepmerge and its parent as two low nodes. However, the [authoritative CVE record](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/93xxx/CVE-2026-93753.json) marks CVE-2026-93753 **REJECTED** on 2 November 2026 because it does not describe a security vulnerability. Preserve the raw audit result while tracking this registry discrepancy separately. This path is build tooling, not an identified application request path. |

The exposure assessments above are source/artifact inferences, not penetration-test results or claims that dormant vulnerable code can never become reachable.

## Remaining work and release conditions

1. Plan a supported Nuxt migration. The primary Nuxt advisories state that Nuxt 3 reached end of life on 31 July 2026 and will not receive these fixes. The cited runtime fixes require Nuxt 4.6.2/4.6.0; the development-bundle fix requires 4.6.3. Select a supported release covering all advisories, then rerun regressions and browser checks. The audit's suggested Nuxt 4.4.8 is insufficient for these later fixes.
2. Update the build tracing/archiving and Drizzle CLI chains when compatible upstream fixes are available. glob's cited fix starts at 14.0.2, minimatch's at 11.0.1 and esbuild's at 0.25.0. Do not force incompatible transitive majors or downgrade Drizzle Kit merely to satisfy an audit suggestion; verify the actual toolchain behavior first.
3. Keep audits current and track the rejected deepmerge CVE until npm's advisory metadata catches up. Reassess exposure if server islands, dynamic head input, public development servers or runtime glob processing are introduced.
4. Follow [SECURITY_DEPLOYMENT.md](SECURITY_DEPLOYMENT.md): configure production `APP_ALLOWED_ORIGINS` before deployment, keep HTTP/WebSocket/client changes in one release, verify proxy identity before selecting Railway headers, and complete deployment-specific authenticated checks. No production database or authenticated staging campaign was used in this verification.

A real Docker build/non-root container smoke test remains unperformed because Docker was unavailable. Static Docker configuration and the generated production artifact were inspected; run the actual image check in CI or an operator environment before release.
