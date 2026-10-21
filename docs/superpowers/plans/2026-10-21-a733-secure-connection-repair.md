# A733 Secure Connection Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task by task. Steps use checkbox (`- [ ]`) syntax. The driver reads and checks this plan before writing code. Read superpowers:test-driven-development before writing either tests or implementation.

**Goal:** Restore the box's HTTPS connection from a public guided page without an owner shell step, while retaining old TLS material and every existing fiscal protection.

**Architecture:** Separate certificate inspection/repair from vault provisioning. A public bootstrap surface remains reachable when the leaf cannot be served; its sole mutation repairs fixed local certificate files under exclusion, archives originals before replacement, and returns the owner to trusted HTTPS. Keep normal setup, first-setup resolution and recovery admission decisions intact.

**Tech Stack:** Existing TypeScript, Hono, Node crypto/TLS/filesystem, node-forge, existing filesystem/locking seams, Vitest and Chromium. No dependency or migration.

**Spec:** `docs/backlog/fiscal.md` → A733; approved repair V2 in `~/waitron-campaign-e/questions.md:4316-4324`, approval `:4374-4381`, watcher release `:6470` onward. Those campaign files are read-only references, not deliverables. The approved transport operation preserves material, prefers a usable retained CA and requires visibly new public trust installation when that CA is lost/unusable. The watcher authorizes A733 ahead of W41s-7; A917 hostname customization remains separate.

## Global Constraints

- HTTP PUBLIC CONNECTION/BOOTSTRAP ONLY, never passwords or keys. No password, recovery key, custody key, private certificate, filesystem path or hostname input. Public CA certificate downloads are allowed; private TLS keys never leave disk.
- No fiscal writer, hash, numbering, SQL, guard or migration change. No marker repair, ownership takeover, restore, activation or database creation in certificate repair. Use the existing lock implementation without editing its SQL.
- Preserve healthy TLS byte for byte. Preserve `secrets.env`, vault key ring, account keys, venue files and retained setup evidence. Missing `server.key` is not permission to replace the CA or vault material.
- Use existing `BOX_LEAF_HOSTNAMES` / `BOX_HOSTNAME`, configured `WAITRON_BOX_ADDRESSES` and existing permitted-IPv4 filtering. Do not widen certificate name constraints or derive signing targets from Host, Origin, query strings or request bodies.
- Keep operator-supplied `WAITRON_TLS_*` priority and never overwrite those arbitrary paths. This feature repairs box-managed TLS only; show a fixed public refusal if operator TLS is selected. Do not promise it repairs an external certificate.
- Preserve behavioral tests. Add assertions rather than replacing them with assertions matching the new implementation. No coverage exclusions, weaker guards or threshold changes.
- Author session writes only this plan, runs no tests, commits nothing and starts no agents. Implementation uses failing behavioral tests first, observes expected failures, then minimal code and passing focused checks. Later commits use `git commit -s`; no hook bypass.

## Audit and File Map

Source inspection only, not runtime verification:

- `apps/server/src/box-secrets.ts`: `ensureBoxSecrets` uses `server.key` as sentinel for all four PEMs; `reissueBoxLeaf` keeps only a transient `.previous` certificate and does not durably preserve originals. Neither is sufficient for this repair.
- `self-signed-cert.ts`: reuse minting, leaf signing and IPv4 policy. `reissueServerLeaf` caps leaf expiry at CA expiry but does not establish CA/key usability. Add validation at the new repair boundary.
- `tls.ts`: `buildServeOptions` reads files; the watcher validates later renewals, not initial boot. `recovery-listener.ts` uses existence-only `mintedBoxLeaf`, and starts landing only after its main listener binds. Missing halves currently choose HTTP; malformed/mismatched halves can prevent reaching recovery.
- `first-setup-launch.ts`: direct resolution does not pass landing config. `node-entry.ts`: supervised resolution precedes recovery level, whereas already-recovery also uses `serveRecovery`. Exercise all three, including a normal admission with damaged TLS.
- `boot.ts`: owns names, address selection, initial certificate provisioning and landing startup; landing currently refuses to start without a minted leaf. `trading-tls.ts` controls served TLS priority. Change transport wiring only; do not weaken strict boot or first-setup guards.
- `landing-app.ts`, `discovery-api.ts`, `trust-page.ts`: public trust help is duplicated across HTTP/HTTPS mounts, and availability means file existence. Reuse one repair route mount; do not download malformed PEMs or unconditionally tell an owner to remove a still-usable retained CA.
- `first-setup-entry.ts`: retain resolution decisions and protected API mounting; attach only a public connection link/config where needed. `apps/setup/src/setup-app.ts` renders the first-owner resolution view using `screens/initial-owner-strings.ts`.
- Create server `box-tls-repair.ts` + `.test.ts` (fixed-file inspection/archive/repair); `connection-bootstrap.ts` + `.test.ts` (public routes). Add `connection-bootstrap.entry.test.ts` for real-entry sockets. Extend existing certificate, landing, entry, discovery and setup resolution tests listed below. Keep types beside their owner rather than creating a framework.

## Review Focus: Five Falsifying Acceptance Cases

1. **Missing server key, usable retained CA:** a real direct entry reaches public repair; CA bytes and fingerprint stay identical, old leaf bytes remain archived, new trusted HTTPS works and vault bytes stay identical. Generating a different CA fails this case.
2. **Malformed, expired or mismatched leaf:** each damage shape reaches repair through supervised normal and already-recovery entry, not just a bare Hono mount; no secret API is usable on HTTP. A socket that never binds fails this case.
3. **Lost/unusable CA:** missing CA cert/key, malformed PEM, expired CA, mismatched CA key, non-CA certificate or unusable constraints yields explicit new-trust guidance and a new public CA. The previous CA must reject the new leaf, and installation of the new CA must permit a real verified handshake. Silent trust continuity fails this case.
4. **Concurrent request or interrupted replacement:** two callers cannot overwrite one another's archive; restart after every durable write/rename resumes the same generation without losing original bytes or generating another CA. Archive/write failure refuses with originals retained; claiming success with mixed active files fails this case.
5. **Healthy TLS / forged action:** a valid same-origin repeat is a byte-for-byte no-op. GET, foreign/missing/null Origin, unapproved Host, query input, nonempty/streamed body, forwarded-protocol tricks and private-input submissions cannot change files. A legitimate same-origin empty POST must still work. Any exposed password/key form on HTTP fails this case.

### Task 1: Certificate-only inspection and durable repair

**Files:** create `apps/server/src/box-tls-repair.ts`, `box-tls-repair.test.ts`; modify `box-secrets.ts`, `self-signed-cert.ts` only where shared signing/initialization requires it; extend their existing tests. Audit every caller of `ensureBoxSecrets`, `reissueBoxLeaf`, `mintedBoxLeaf`, `caCertPath` and `resolveTradingTls` before changing sentinel/gating semantics.

**Interfaces:** export `inspectBoxTls(deps: BoxTlsRepairDeps): Promise<BoxTlsInspection>` and `repairBoxTls(deps: BoxTlsRepairDeps): Promise<BoxTlsInspection>`. Dependencies contain trusted `stateDir`, `hostnames`, `listIpv4`, `now`; no request values. Inspection exposes only `state: 'healthy' | 'repair-required' | 'refused'`, `trust: 'retained' | 'new-required'`, `caAvailable: boolean`, and an optional public SHA-256 CA fingerprint. Keep file paths, PEM keys and detailed filesystem errors internal.

- [x] Write cases 1, 3, 4 and the healthy part of 5 first. Snapshot every retained PEM, `secrets.env` and unrelated evidence; assert actual signature/key matching, dates, SANs and Node TLS usability, not only file existence. Run the Task 1 command below and observe the expected missing behavior before implementation.
- [x] Validate leaf PEM, matching private key, validity, server use and configured names/addresses; validate retained CA PEM/key match, signing authority, validity and ability to issue the required constrained leaf. Parse/read errors are classified without logging PEM. Permission/I/O errors refuse instead of being treated as absence. A healthy served pair is untouched even if its signing key is unavailable; missing CA signing material matters when repair is needed.
- [x] Use `withRecoveryLock(stateDir, body)` as the existing cross-process exclusion seam; do not nest it inside an already-held recovery lock. Reinspect after acquiring it. Make initial box TLS creation, repair and existing leaf-reissue writes cooperate with the same exclusion. Leave `recovery.json` unchanged and never unlink its lock. Split vault initialization from TLS initialization so certificate repair cannot generate or replace the vault ring.
- [x] Before replacing anything, create a unique private `tls/repair-archive/<server-generated-id>/` directory (0700), copy every existing fixed TLS original (including any old `.previous` artifact) with exclusive creation (0600), record absent members, flush copied files and manifest, then flush directories. No replacement until archive completion is durable. Refuse symlink/nonregular managed TLS entries rather than following them; retain existing general tightening behavior outside repair. Do not archive secrets.env into this directory.
- [x] Stage a complete validated candidate generation and a small durable pending manifest referencing only internally generated names; fsync files/directories before any active replacement. Keep retained CA files untouched when usable. Otherwise stage a new CA/leaf and persist `new-required`. Replace fixed active paths, flushing directory entries; validate the complete installed set before marking complete. Retain archive and trust outcome across restart. Reuse existing filesystem patterns, but `writeFileAtomic` alone has no fsync and is not a durability receipt.
- [x] On interruption, resume the pending candidate under exclusion before declaring healthy; never treat a partial replacement as fresh setup or mint another CA. On failure, retain original archive and pending state, refuse success and keep bootstrap available for retry. Where practical restore active originals; do not promise a four-file atomic transaction. Archive failure before replacement leaves original active bytes unchanged.
- [x] Preserve true first-ever initialization when all TLS material and vault state are absent. Partial/retained state must enter guided repair rather than use the old sentinel to overwrite it. Update old sentinel-specific tests only to the approved preservation behavior; retain vault and permission assertions. Run Task 1 checks green; signed-off focused commit.

**Limits:** The lock excludes cooperating Waitron writers, not an administrator editing files. Per-file rename is atomic, the set is not; pending state prevents serving mixed files. fsync requests durability from the local filesystem, not protection from a failed disk. Local hostile filesystem mutation and HTTP interception are not authenticated by this feature.

### Task 2: Public bootstrap routes and real listener plumbing

**Files:** new `connection-bootstrap.ts`, `.test.ts`; modify `recovery-listener.ts`, `first-setup-launch.ts`, `node-entry.ts`, transport sections of `boot.ts`, `landing-app.ts`, `discovery-api.ts`, and corresponding existing listener/entry tests. Do not edit fiscal/admission guards.

**Interfaces:** `mountConnectionBootstrap(app: Hono, deps: ConnectionBootstrapDeps): void`; consumes Task 1 operations, trusted reach configuration and `onRepaired: () => Promise<void>`. Routes: `GET /setup/connection` public guidance/status; `POST /setup-api/connection/repair` mutation and an empty `POST /setup-api/connection/continue`; reuse `/setup/trust`, `/ca.crt`, `/setup-api/ca.crt` for validated public output. `onRepaired` runs after the explicit continuation response has been flushed on standalone bootstrap. Repair leaves that HTTP guide alive for public CA installation. Normal HTTPS mirrors retain their existing post-repair handoff.

- [x] Add route refusal/legitimate control tests for case 5 and entry binding tests for case 2. Observe expected failures with Task 2 commands.
- [x] Require exact Origin equal to the actual listener's allowed scheme/authority, with Host checked against server-derived known names/addresses and port; reject missing/null Origin, foreign Origin, query strings and any body before repair. Both actions use `fetch(path, {method: 'POST', credentials: 'omit'})` with no body. Check actual streamed bytes with a small bound, not Content-Length alone. Ignore forwarded Host/protocol. Reject credential-bearing requests; never parse JSON/form/private fields, echo request inputs, log request bodies or provide CORS access. Return Task 1 public status, the canonical public CA certificate and `continuationRequired`, or fixed public errors, with no-store headers.
- [x] Inspect TLS before binding, without calling `ensureBoxSecrets` to cure damage. On damaged box TLS, serve a bootstrap-only app on the configured main port, plus the configured HTTP landing port when enabled. Do not mount the setup SPA, recovery log tail, Retry, resolution inspection/mutations, login, restore or fiscal routes onto this HTTP fallback. Unknown routes refuse. Landing must not depend on successful HTTPS bind or existence of both leaf files.
- [x] Cover direct normal/resolution, supervised normal/resolution and already-recovery paths. Preserve selected workspace roots and existing admission order. Preflight damaged transport before strict normal boot can overwrite TLS; do not bypass later admission checks. Healthy paths keep their existing listener behavior. Keep normal HTTPS mirrors of public help working.
- [x] After successful file repair, keep standalone HTTP available for CA download and reload, including after a discarded reply. Only the explicit Reconnect action admits continuation: the supervised path uses its existing restart request after that response flush; the direct launcher closes bootstrap listeners and re-enters `startServerOrFirstSetupResolution` internally, updating its returned close handle. It must re-run the full admission path, not call raw `startServer` on an unresolved workspace. Already-recovery re-enters with recovery state unchanged. Supply explicit continuation callbacks; never rely on Docker restart to make direct entry usable. Bind/transition failure remains a public retryable outcome, with all started listeners closed on shutdown.
- [x] Run Task 2 tests green, including assertions that no strict start, staged work, activation or venue writes occur while bootstrap is serving. Signed-off commit.

**Execution ruling, 2026-10-21:** the first real lost-reply/public-download probe failed when repair switched the main port to HTTPS before the new CA could be downloaded. Explicit continuation supersedes that early handoff. A successful repair also supplies the canonical public CA certificate and `continuationRequired`; the page retains a Blob download. A healthy bootstrap reload embeds the same canonical public certificate. The private source file is never embedded. This adds no private input or ownership authority. The actual `/continue` shares the repair route's Origin, Host, credential and empty-body checks and refuses an unready TLS set.

**Security limit:** Origin checks prevent ordinary browser cross-site forgery; HTTP supplies no cryptographic peer identity and cannot exclude a malicious network participant or arbitrary HTTP client. State this limit in developer documentation without claiming that public repair authenticates the owner.

### Task 3: Setup link and localized trust guidance

**Files:** `apps/setup/src/setup-app.ts`, `screens/initial-owner-strings.ts`, `setup-app-resolution.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`; server `trust-page.ts`, new `connection-bootstrap-strings.ts`, `trust-page.test.ts`, `trust-page-devices.test.ts`, `landing-app.test.ts`, `discovery-api.test.ts`. Keep Spanish only in translation files.

**Interfaces:** extend `TrustPageInput` with optional repair/trust outcome and locale; absent options retain ordinary trust-help rendering. Resolution links to the fixed `/setup/connection` path. The bootstrap page uses Task 2 routes, no setup API client carrying owner tokens.

- [x] Add failing browser tests for the resolution link, unchanged dirty-draft behavior and EN/ES labels; add public page tests for retained CA, new CA, refusal, in-progress, retry and completed states. Use “Set up secure connection” / “Configurar conexión segura”. Explicitly say a lost/unusable CA requires installation of a new public certificate; retained-CA repair must not tell every owner to remove existing trust.
- [x] Add the link to the first-owner resolution view. Bootstrap contains one explicit repair button, public certificate download/help and known HTTPS reconnect links. No password/file/key inputs or secret-producing controls. Explain that you reconnect to the venue network and known box address, install/trust the public certificate when needed, and reopen HTTPS without warnings before recovering setup. Never suggest a terminal, installer call or editing files.
- [x] Keep device-specific installation help, both themes, offline assets and existing reach URLs. Use fixed EN/ES messages, language selection/browser language consistent with existing setup behavior, accessible status/error feedback, keyboard controls and existing token conventions. A refused request can be retried without reloading. Healthy TLS shows continuation, not a rotation action.
- [x] Run Task 3 commands green. Restore language state after tests; use real native controls and userEvent. Signed-off commit.

### Task 4: Real entry controls, visuals, documentation and final review

**Files:** new `apps/server/src/connection-bootstrap.entry.test.ts`; extend `first-setup-resolution.route.test.ts`, `first-setup-resolution.boot.test.ts`, `node-entry.test.ts` without replacing old assertions. Update `docs/backlog/fiscal.md` (delete completed A733 only), `docs/developers/conventions-ui.md` and relevant certificate/recovery operator documentation found by prose audit. Do not rewrite historical specs or campaign files.

- [x] Write failing acceptance cases 1–5 through real entry functions and bound sockets. Use `freePorts(n)` once per fixture, temporary folders and real crypto; stub only unrelated startup work and restart scheduling. Test direct missing/malformed/expired/mismatched leaf; parameterize supervised normal and already-recovery modes. Verify HTTPS with CA validation enabled and expected SAN hostname, plus a negative old-CA control after replacement. Never use `rejectUnauthorized: false` as acceptance evidence.
- [x] Inject interruption at archive, candidate, manifest and each active-file rename boundary; restart with fresh dependencies/process where needed. Test real cross-process lock release after interruption and two competing repairs. Assert archive bytes remain readable locally, archives never appear on public routes, and unrelated evidence stays unchanged.
- [x] Exercise no-body valid requests and all forged/private-input controls over actual HTTP, including `X-Forwarded-Proto: https`. Keep existing HTTP owner-password refusals. Trace and audit all consumers of changed TLS availability semantics and all prose about sentinel, CA preservation, landing gating and recovery transport; edit only claims this feature makes stale.
- [x] Open the actual rendered public page using workspace Playwright Chromium in EN/ES, light/dark, phone/desktop, including new-trust and refusal states. Inspect screenshots and keyboard behavior; check no clipped actions or password controls. Run resolution accessibility tests and inspect actual UI, not only HTML strings. Use temporary artifacts outside tracked source and close only processes started for this work.
- [ ] Run the focused command set below and review the whole base-to-tip diff against V2/H2. Record commands, test counts, controls and limitations. Do not claim package coverage from a focused pass. Have `finish-branch` perform the required Claude run-it whole-branch review after its initial rebase, normal hook and current-head CI. No guard edits, skip comments, fiscal changes or extra owner approval for routine implementation choices. Announce readiness for `finish-branch` when implementation validation is complete; do not merge without the owner's landing authorization.

## Exact Focused Commands (Implementation Only)

Run each command from this worktree, read its test count and exit status, and retain the expected red then green result. New filenames below are specified by this plan. Do not run these in the plan-author session.

1. `pnpm --filter @waitron/server exec vitest run src/box-tls-repair.test.ts src/box-secrets.test.ts src/self-signed-cert.test.ts src/self-signed-cert.serial.test.ts src/tls.test.ts src/trading-tls.test.ts`
2. `pnpm --filter @waitron/server exec vitest run src/connection-bootstrap.test.ts src/landing-app.test.ts src/landing-listener.test.ts src/discovery-api.test.ts src/node-entry.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts`
3. `pnpm --filter @waitron/server exec vitest run src/trust-page.test.ts src/trust-page-devices.test.ts src/landing-app.test.ts src/discovery-api.test.ts`
4. `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts src/setup-app-resolution.a11y.test.ts src/setup-app-resolution.unsaved.test.ts src/setup-app.test.ts src/setup-app.theme.test.ts`
5. `pnpm --filter @waitron/server exec vitest run src/connection-bootstrap.entry.test.ts src/first-setup-resolution.route.test.ts src/first-setup-recovery.route.test.ts src/first-setup-finish.route.test.ts src/first-setup-selection.route.test.ts`
6. `pnpm --filter @waitron/server typecheck` and separately `pnpm --filter @waitron/setup typecheck`.
7. `git diff --check` and `git diff --name-only` for scope review. Existing root guards run unchanged through the normal push hook; CI owns package coverage at the current head. This is Waitron, not Waitron Cloud; do not add a whole-workspace local test run just for finishing.

**Changed-check policy:** only the explicitly listed TLS/transport/setup behavioral suites gain or update approved assertions. Existing startup expectations may change solely to public-only fallback and durable preservation. No root guard, fiscal test expectation, schema snapshot, SQL, CI threshold, test exclusion or package configuration change is authorized. New focused suites are allowed. If an unchanged guard fails, investigate without weakening it; a required fiscal/guard change is a scope blocker for the driver to report.

**Plan self-review:** Tasks map the five acceptance cases to concrete tests; Task 1 owns durability/trust, Task 2 owns routing and entry lifecycle, Task 3 owns copy/UI, Task 4 owns real sockets, controls and evidence. No runtime claim above is presented as verified by this plan-author session.


### Review execution ruling — network changes and reserved leaves

A changed interface address alone must not stop hostname-valid HTTPS startup. Startup inspection
therefore omits the current-address requirement; explicit repair still signs current addresses.
Resuming an interrupted repair validates its reserved authority and signed leaf identity, then
refreshes only the leaf if addresses or its validity interval changed, durably saving that leaf
before installation. The reserved CA and original archive remain unchanged. Linked TLS layouts
retain the plan's explicit refusal; the public-repair limitation is recorded in the backlog.


CI identified two further protected-transport fixture consumers: `boot.till-clock.test.ts`'s recovery
listener case and both bundled entry cases in `first-setup-bundle.test.ts`. Their unchanged protected
status and route-absence assertions now run over CA-verified HTTPS with real box TLS fixtures.
