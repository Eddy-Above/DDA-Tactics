# Security deployment and operator checks

## Release boundary

Deploy the HTTP handlers, WebSocket handlers and browser client together. Movement and door changes now go through validated HTTP commands. WebSockets deliver committed updates; clients cannot write positions, map geometry or door state through that channel. A GM structure-damage message is authorized, persisted in a transaction and broadcast after commit. Old browser tabs must reload after deployment.

There is no database migration. Existing saved maps and characters keep their formats. Do not use a live database for builds, tests or type checks. The verification scripts explicitly set an inert database URL and prohibit unmocked queries.

The public campaign directory and public campaign metadata remain intentional. Campaign names, descriptions, identifiers, owner identifiers, protection flags and rules settings remain discoverable. This release protects campaign contents and privileged operations; it does not make discovery private. The existing username lookup also remains public.

## Runtime configuration

Set these on the deployed application, using the deployment's secret/configuration management:

| Variable | Value and behavior |
| --- | --- |
| `DATABASE_URL` | The intended application's PostgreSQL connection. Keep it in deployment secrets, outside source control and images. |
| `APP_ALLOWED_ORIGINS` | Required in production. Comma-separated exact browser origins, for example `https://dda.example,https://preview.dda.example`. Include scheme and an explicit port when applicable. Do not include paths, trailing slashes or wildcards. Invalid or absent production configuration prevents startup. |
| `DDA_CSP_REPORT_ONLY` | Defaults to `true` for the CSP rollout. Set `false` only after reviewing the application flows below against the policy. Other security headers and application authorization still apply during report-only mode. |
| `CLIENT_IP_SOURCE` | Defaults to `socket`. Set `railway` only after the ingress diagnostic below proves that Railway replaces `X-Real-IP` with the actual client address on every publicly reachable path. `X-Forwarded-For` is never used to select the rate-limit identity. |
| `IP_DIAGNOSTIC_TOKEN` | Normally absent, which disables the diagnostic endpoint with 404. Temporarily set a strong random operator bearer secret for the ingress check; remove it afterward. |

Use HTTPS for production browser access. Unsafe HTTP requests and WebSocket connections require an allowed `Origin`; scripts that deliberately make write requests must also send that exact Origin. A valid Origin alone does not authorize campaign access.

## Verify the trusted client IP at the public ingress

Keep `CLIENT_IP_SOURCE=socket` while checking. Temporarily configure `IP_DIAGNOSTIC_TOKEN` in the deployment. From outside Railway, determine your current public egress IP independently and set these local PowerShell variables without putting secrets in the repository:

```powershell
$env:DDA_ORIGIN = 'https://dda.example'
$env:DDA_PUBLIC_IP = 'YOUR_CURRENT_PUBLIC_EGRESS_IP'
# Populate IP_DIAGNOSTIC_TOKEN in this shell from the same operator secret.

curl.exe --fail-with-body "$env:DDA_ORIGIN/api/ops/ip-diagnostic" `
  --header "Authorization: Bearer $env:IP_DIAGNOSTIC_TOKEN" `
  --header 'X-Forwarded-For: 203.0.113.7' `
  --header 'X-Real-IP: 203.0.113.8' `
  --header "X-Diagnostic-Expect: $env:DDA_PUBLIC_IP"
```

The endpoint returns comparison booleans and the selected source, never raw IP addresses or database data. It performs no database queries.

- `realIpMatchesSentinel=true` means the supplied fake `X-Real-IP` survived ingress. Do not enable `railway` for that path.
- `forwardedForContainsSentinel=true` shows the supplied XFF marker survived. XFF remains unsuitable as an identity source regardless of this result.
- `selectedMatchesSentinel` must remain `false`.
- With `socket`, `expectedMatchesSelected` may be false because the socket belongs to Railway's proxy. That does not justify trusting a header.

Only after verifying that the fake real-IP marker is consistently replaced, temporarily test `CLIENT_IP_SOURCE=railway` with the same request. Require `realIpMatchesSentinel=false`, `selectedMatchesSentinel=false` and `expectedMatchesSelected=true`. Repeat through every public hostname and ingress path that reaches the app, including the path used for WebSocket upgrades. If the result is uncertain, keep `socket` and address proxy-level rate limiting separately. Remove `IP_DIAGNOSTIC_TOKEN` after verification and confirm the endpoint returns 404 again.

## Existing campaign credentials

Anonymous GM access is allowed only when a campaign has no owner account, no player password and no GM password. This intentionally preserves fully public campaigns. A player password alone never grants GM privileges. Account-free invited players can use player controls for the campaign's player characters; per-player guest character ownership is outside this release.

Account-owned campaign settings and deletion require the owner or a co-owner account. A co-DM or GM-password guest may run GM gameplay but cannot manage an account-owned campaign's settings or deletion. Unowned Workshop characters remain publicly editable; account-owned Workshop characters require their owner for edits.

Review fully public campaigns and decide which should stay public. Where protection is wanted, set a player password and a separate GM password through authorized Settings. Rotate previously shared campaign passwords through Settings and distribute the new values through the campaign's existing trusted channel. Password changes invalidate live campaign peers and signed cookies derived from the previous password hash. Users must verify again and reload. Logout also closes peers using that account session.

Successful checks of legacy password hashes upgrade them to the versioned PBKDF2-HMAC-SHA512 format with 220,000 iterations. Do not edit stored hashes manually or print them while diagnosing access. Remove obsolete deployment credentials and rotate any credential that was exposed outside its intended audience.

## Repair an ownerless campaign with no GM password

An ownerless campaign that has a player password but no GM password is deliberately closed to GM operations. Use the operator utility to add its missing GM credential. This utility cannot claim ownership, change account-owned campaigns or overwrite an existing GM password.

Run it from a trusted source checkout with dependencies available, not through a public API. The final runtime container contains only the application output, so it does not contain this operator script. Explicitly inject the intended `DATABASE_URL` into the operator process. The script never loads `.env` or `.env.local`; it refuses offline verification mode. Confirm the target deployment and campaign before applying the change.

From `app/`, inspect first; this is a read-only dry run:

```powershell
node scripts/secure-campaign-gm.mjs --campaign-id CAMPAIGN_ID
```

Then apply, using the interactive hidden password and confirmation prompts:

```powershell
node scripts/secure-campaign-gm.mjs --campaign-id CAMPAIGN_ID --apply
```

For noninteractive operation the utility can read one password from standard input. Use a secret manager to provide it; do not put a literal password in command history, arguments, logs or a committed file. The utility prints a status summary without credentials. The update requires both `owner_id IS NULL` and `dm_password_hash IS NULL` at write time, so a concurrent change cannot be overwritten. After repair, verify the new GM password through the application. Restarting the app after an operator repair also clears any existing room sessions.

## Verification before opening the deployment

Run `npm test`, `npm run typecheck` and `npm run build` from `app/` using the guarded package scripts. No verification step should use production database credentials. The security tests use in-memory adapters and inert database settings, including real route-boundary authorization tests.

Check the deployed application using separate outsider, player and GM browser sessions:

- Outsiders cannot load protected campaign contents or subscribe to either protected WebSocket channel.
- Directly opening any Library list, create or edit URL (including Digimon, Tamers, evolution lines and fullscreen maps) requires verified GM access. Test a campaign with only a GM password, a player credential and a forged boolean GM cookie. Account owner/co-owner/co-DM grants and verified GM credentials should still enter; wholly public ownerless campaigns retain their intended anonymous GM access.
- Player guests can use Direct, Mode Change, legitimate movement and nearby doors. They cannot edit geometry, issue GM actions or change settings and grants.
- Player sheet saves can echo unchanged GM grants and unlocks, but direct API requests cannot alter granted Inspiration, daily evolution counters, GM-marked Torments or evolution unlock states. Normal player edits, XP refunds down to the GM-marked floor and permitted Workshop editing should still work. Evolution refresh must retain a concurrent GM lock change and cannot bypass unlock protections through changed form links.
- Valid GM sessions can perform their permitted operations. Expiry, logout, password changes and grant revocation stop live access and show the client's access/reload prompt.
- Invalid movement paths, placements, budgets and action-cost bypass fields fail without changing resources, doors or token positions. Charge and Pass retries do not spend twice. GM movement retains its intentional unrestricted behavior.
- Database failure sends no empty full-state and publishes no uncommitted movement or structure changes. Retry restores the stored state.

While CSP is report-only, exercise the map renderer and WebSockets, forms, scenes, sprite selectors, import/export and image previews. Confirm HTTPS images display, legacy HTTP images use the local placeholder without a fetch, and allowed local previews work. Check CSP console reports before setting `DDA_CSP_REPORT_ONLY=false`; then repeat these flows with enforcement. A failing external HTTPS image should also use the placeholder.

Build the Docker image and inspect that its runtime user is `node` and only `.output` is copied into the runtime stage. Confirm `.env*`, source checkouts, development caches and operator scripts are absent from the final image. The image uses Node 24 Alpine. A real Docker build/non-root runtime smoke test was not available in the implementation environment because Docker was unavailable; perform that check in CI or an operator environment before release. Use inert credentials for a smoke test, and never attach the production database merely to check process startup or headers.
After a guarded production build, run `node scripts/verify-security-browser.mjs` from `app/` with Node 24. Set `SECURITY_SMOKE_CHROME` if Chrome is installed elsewhere. The harness uses a guarded loopback server, an isolated headless profile, local HTTPS image fixtures and an explicitly mocked login response; it checks hydration, nonces, images, WebSocket CSP and report-only/enforced behavior without a real database. It does not validate real credentials or replace staging gameplay checks.
