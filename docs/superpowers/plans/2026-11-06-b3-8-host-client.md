# B3, eighth pull request: the server's client for the host's requests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Give Waitron's server a typed way to ask the box's host service (the small root service outside Docker that changes the box itself) each of the seven requests B3's PR 7 defined, without wiring it to anything yet. `boxHostRequests()` in `apps/server/src/box-host-client.ts`:

- writes exactly the line `formatHostRequest` (PR 7's request writer in `scripts/box/host-protocol.mjs`) writes, sends it over the box's local connection point `/run/waitron-box/box.sock` (a *Unix-domain socket*, a file-like address only processes on the same machine can connect to), and checks every reply with `parseHostReply` (PR 7's reply reader), so server and host judge requests and replies by one set of rules;
- reads at most 4096 bytes of reply, waits a fixed time per request, and never throws: every failure is an answer with `available: false`, as slice 9b's clock client does, because a box without the host service (a laptop, Docker Desktop, a box installed before this service exists) still sells;
- reads `unknown_request` as "this host does not take THIS request", for that request only, and reads `request_invalid` to a line longer than the shell handler's 700-character read the same way, because a box that has only slice 9b's shell handler answers that before it even reads the request's name;
- reads a complete reply that arrives just before the connection is broken, which is what Linux does when the shell handler stops reading a long line (measured, re-map finding 9).

Nothing calls it: no route, no screen, no boot wiring. The clock requests' client, `boxHostClient()`, answers exactly as before.

> 2026-11-06, as built: both clients now read an empty socket path as the default and answer `missing` for a path the connection refuses at once, the clock client included ([box.md, PR 8](../../backlog/box.md)).

**Architecture:** One server file, `apps/server/src/box-host-client.ts`, gains a second factory beside the clock client's, sharing the socket code. It imports PR 7's module from the repository's root `scripts/box/` by relative path; a small TypeScript description of that module's types (an *ambient declaration*, a `.d.ts` file that tells TypeScript what a JavaScript module exports) lives in `apps/server/src/box-scripts.d.ts` (D1). `scripts/box/host-protocol.mjs` gains exported lists of the values its replies may hold, so the server's types can be held to them by a test (D9).

**Tech Stack:** Node 26 (`node --version` printed `v26.13.0` on 2026-11-06), TypeScript 7 in `apps/server`, Vitest 4.1.12. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §8, the host service (lines 913–922 on main at `e2e9bd26c6`: "it accepts a fixed list of requests and nothing else").

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md), Slice 3 Task 3.1: its **Interfaces** paragraph (line 174: "`boxHostCall<T>(request:HostRequest):Promise<T>` in new server client wraps the private socket with bounded request/response sizes/timeouts"), PR 7's pointer under it (line 176), and the `box-host-api.test.ts` step (line 217), which stays for the routes pull request.

**Previous pull request:** [PR 7's plan](2026-11-05-b3-7-host-protocol.md) (#2474), especially D1 (the clock requests stay on slice 9b's shell handler), D8 (a join or forget answers once started), D13 (`network.read`'s shape), D14 (refusals) and D16 (how the client reads `unknown_request` and a shell-only box's `request_invalid`).

**Build authority:** the owner's "Yes, build it", 2026-11-01, with the build cut one pull request at a time ([PR 1's plan](2026-11-01-b3-1-encrypted-disk.md), "Build authority").

## Global Constraints

- **Machine limits on 2026-11-06:** macOS, unprivileged. No box, systemd or NetworkManager. Docker Desktop runs Linux containers (re-map finding 9 used one); no test in this pull request needs Docker.
- **No tables, columns, indexes, triggers or migrations** (the owner's A1308 hold). Nothing here needs one.
- **Nothing keyed per location** (the owner is removing that concept).
- **Unwired.** No route, no screen, no change to `boot.ts`, `deploy/`, or the clock client's answers. `boxHostClient`'s interface and its three fakes in `boot.clock-correction.test.ts:67`, `boot.clock-sync-alert.test.ts:24` and `boot.clock-watch.test.ts:167` do not change.
- **The clock client's tests are the guard on the shared code:** `apps/server/src/box-host-client.test.ts` is not edited by any task, and its 31 tests pass after every task (re-map finding 11).
- **No password leaves the request line.** A Wi-Fi password the caller hands `networkJoin` appears only in the one line written to the socket. It is in no answer, no console output and no thrown error. JavaScript strings cannot be wiped, so nothing claims the password is erased from memory (PR 7's note, `docs/backlog/box.md`, PR 7's "Built so far").
- **Coverage:** `apps/server` holds `98/98/98/95` (`apps/server/vitest.config.ts`, `thresholds`); the root project holds the same for `scripts/**/*.mjs`. No exclude, no ignore comment, no moving code into `src/testing/` to dodge it. `apps/server` is not mutation-tested (CLAUDE.md §2 lists `ui`, `ui-core`, `shared`, `fiscal`, `db`, `node-db`, `handover`), so every test names the assertion that fails when the behaviour is deleted, and each task's deletion controls prove it.
- **Code style:** English only (CLAUDE.md §3). Comments only for an invariant or a reason the code cannot show; no decision numbers from this plan in code. The client's answer words (`unsupported`, `invalid`) are values in an answer, not error codes, so `apps/server/src/errors.ts` gains nothing.
- **Tests:** no existing assertion in any test changes; counts only grow.
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.
- **Review weight:** this is a cross-package contract (server and host must agree on every line and reply), a risk trigger, so the branch takes the FULL `/finish-branch` path: the per-task reviews and the full wave, with **two** Codex run-it reviews side by side, the second told to set this plan's checklist aside and test what it does not name.

## Review Focus

1. **The clock client is untouched in behaviour.** Expected: `box-host-client.test.ts` unedited and green; the one new clock case (Task 4) pins that a complete clock reply followed by a broken connection still answers `lost`, as today. Tasks 2, 4.
2. **Nothing the protocol refuses is sent.** Expected: when `formatHostRequest` throws, for any reason including a throwing getter, the answer is `{available:false, reason:"invalid"}` and the fake host saw no connection. Tasks 2, 3.
3. **"Unsupported" is read narrowly.** Expected: `unknown_request` reads as unsupported for that request only, and `request_invalid` only when the line sent was over 700 characters; `request_invalid` to a shorter line stays a refusal. Tasks 2, 4.
4. **A reply cut short is never read as whole.** Expected: a complete reply followed by a broken connection is read; a partial one is `lost`; a reply cut by the client's own byte limit is `malformed`. Tasks 2, 4.
5. **The password stays in the line.** Expected: the canary sweep (Task 3) finds it once in the line the host received and nowhere in any answer.
6. **The server's value unions cannot drift from the protocol's lists unseen.** Expected: each union of reply values is held both ways, by the server's typecheck and by a run-time equality with the module's exported list. The hand-written function signatures in `box-scripts.d.ts` are not held this way (D1), and `host_failed` is held only as a literal in the test (D9). Task 5.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Source |
| --- | --- | --- |
| 1 | `scripts/box/host-protocol.mjs` and its test: export the reply value lists, frozen | D9 |
| 2 | `apps/server/src/box-host-client.ts`: the shared socket reader, `boxHostRequests().networkRead`, every failure word; `box-scripts.d.ts`; a fake host under `src/testing/`; the root-scope entry | parent line 174 ("bounded request/response sizes/timeouts"); D1–D8, D11 |
| 3 | same file: the other six requests, their refusals, per-request waits, the canary sweep | parent line 174; PR 7 D8, D14; D6, D10 |
| 4 | same file: a shell-only box (the 700-character rule), and a complete reply before a broken connection, against the real shell handler too | PR 7 D16; box.md PR 7 re-map; D4, D5 |
| 5 | the server's types held to the protocol's lists; two more root-scope entries | D9, D11 |
| 6 | backlog (`docs/backlog/box.md`, `docs/backlog.md`), pointers in the parent plan | — |

**Out, and where each goes next:**

- **The `system.manage` routes** (`apps/server/src/box-host-api.ts`, the parent's line 217 step): minting the actor from the signed-in person's session, checking `system.manage`, passive reads, no password in logs, and the error codes a route answers for each of this client's answers. Slice 3's routes pull request.
- **Boot wiring:** building `boxHostRequests()` in `boot.ts` and handing it to the routes. The routes pull request.
- **The dashboard's "This box" screen** (Task 3.2): turning `unsupported`, `missing` and each refusal into words a person reads.
- **The shell handler forwarding B3's requests to a Node host**, which needs Linux and systemd: letting a B3 line past the 700-character read, and measuring how long a forwarded read, scan and change take. Slice 3's Linux pull request. Whether the 700-character rule (D4) is still needed once forwarding lands is that pull request's question.
- **The Linux adapters, the host service itself, `tag.write`'s caller** (the duty that writes the name tag at handoff and after a rename): slice 3's Linux and routes pull requests.
- **Whether the clock client should also read a complete reply before a broken connection** (D5): a backlog item (Task 6).
- **CI selecting the server's tests when `name-tag.mjs`, `upgrades/contracts.mjs` or `disk-key.mjs` alone change** (D11): a backlog item (Task 6).

## Re-map against main on 2026-11-06

Main at `e2e9bd26c6` (`origin/main` moved to `894958f26c`, one test-fixture rename in an unrelated file; `git diff --stat e2e9bd26c6 origin/main` over this plan's paths printed nothing).

1. **The clock client, as built.** `apps/server/src/box-host-client.ts`: `exchange` (`:47-108`) connects, writes the line on `connect`, answers `missing` with the error code as `detail` for an error before connecting and `lost` after (`:63-67`), stops reading and answers `malformed` past 4096 bytes (`:37`, `:72`), answers `lost` for an empty reply and `malformed` for anything but one line ending in one newline (`:78-87`). `DEFAULT_STATUS_MS = 2_000`, `DEFAULT_SET_MS = 20_000` ("Longer than the host unit's `RuntimeMaxSec=15`", `:34-36`). `boot.ts:2255` builds it; `clock-correction.ts:85` takes it as a dependency; three boot tests fake its interface as object literals (Global Constraints).
2. **The shell handler, as built.** `deploy/box/waitron-box.sh:161` reads `-n 701` characters within `READ_SECONDS` (5, `:18`); a line over 700 characters, or none, is `request_invalid` (`:162-166`); any line other than the clock's two is `unknown_request` (`:177`). Each connection gets its own instance (`Accept=yes`, `deploy/box/waitron-box.socket:6`) stopped at `RuntimeMaxSec=15` (`deploy/box/waitron-box@.service:11`).
3. **PR 7's module.** `formatHostRequest` (`scripts/box/host-protocol.mjs:204`) throws `host_request.invalid` for anything it would not write; `parseHostReply` (`:399`) answers `{kind:"ok", value}`, `{kind:"refused", reason}` or `{kind:"malformed"}` and checks text over `HOST_REPLY_MAX` (4096, `:25`) first. The value lists its replies use are module-private: `START_SCREENS` (`:61`), `PARSER_REFUSALS` (`:218`), `REPLY_REFUSALS` (`:221`), `CHANGE_KINDS`, `CHANGE_STATES` (`:231-232`), `CHANGE_REFUSALS` (`:234`), `SCAN_SECURITY`, `TAG_OUTCOMES` (`:238-239`); four of them are not frozen. It imports `name-tag.mjs`, `upgrades/contracts.mjs`, `wifi-boot-copy.mjs` (which imports `disk-key.mjs`) and `wifi-record.mjs`, all under `scripts/box/`, and only Node built-ins.
4. **Request line lengths**, measured with `node --input-type=module -e` over the real `formatHostRequest` on 2026-11-06, person id `0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11`: a WPA3 (`sae`) join whose password is 90 `é` and one `x`, SSID `4361666550657065`, `hidden: false`, is exactly **700** characters, and with two `x` **701**; a `tag.write` whose name is `a` and 105 `é`, `live: true`, is **700**, and with `aa` **701**. PR 7 measured the longest join at 1003 and the longest `tag.write` at 3142 (its finding 16).
5. **Nothing in `apps/` or `packages/` names `scripts/box/`** today (`git grep -n "scripts/box" -- apps packages` printed nothing). App code that imports root `scripts/` does so only from build or test files (`apps/server/vitest.config.ts:3`, `apps/dashboard/vite.config.ts:4-5`, test files naming `scripts/bundle-node.mjs`); `apps/server/src/demo-seed.ts:3` imports the server's own `apps/server/scripts/`, inside the package (`git grep -n "\.\./\.\./scripts\|\.\./\.\./\.\./scripts" -- apps packages`).
6. **The sharing experiment** (D1's receipts), run on 2026-11-06 with a throwaway `apps/server/src/zz-probe.ts` importing `formatHostRequest` and `parseHostReply` from `../../../scripts/box/host-protocol.mjs`, its test, and (for step f) `git add -N` so tracked-file guards saw them; all removed afterwards and `git status --short` printed nothing:
   - a. `pnpm exec tsc --noEmit` in `apps/server`: `error TS7016: Could not find a declaration file for module '../../../scripts/box/host-protocol.mjs' … implicitly has an 'any' type.`, exit 1.
   - b. `tsc --noEmit --allowJs`: `error TS6059: File '…/scripts/box/host-protocol.mjs' is not under 'rootDir' '…/apps/server'` for it and each module it reaches, exit 1. `tsc --noEmit --allowJs --rootDir ../..`: exit 0, and two deliberate type errors (`const n: number = formatHostRequest(…)`, a `kind` compared with `"nope"`) failed with `TS2322`, so the module's JSDoc types reached the server.
   - c. A hand-written `scripts/box/host-protocol.d.mts` beside the module, no `allowJs`: the same two `TS2322` errors and no `TS7016`.
   - d. An ambient declaration `declare module "*/scripts/box/host-protocol.mjs" { … }` in `apps/server/src/zz-probe-protocol.d.ts`, no `allowJs`: with a deliberate error, `TS2322`; without it, exit 0. `pnpm exec eslint` on the `.d.ts` exited 0. A one-file coverage run with `--coverage.include='src/zz-probe*.ts'` listed only `zz-probe.ts`, not the `.d.ts`.
   - e. `pnpm --filter @waitron/server exec vitest run src/zz-probe.test.ts`: `Tests  1 passed (1)`. `pnpm exec eslint` on both probe files: exit 0.
   - f. `pnpm exec node ../../scripts/bundle-node.mjs src/zz-probe.ts=<tmp>/probe.js` in `apps/server` (the bundler every Node bundle goes through): `36.1kb`, `Done`; the bundle held `// ../../scripts/box/host-protocol.mjs`, `name-tag.mjs`, `upgrades/contracts.mjs`, `wifi-boot-copy.mjs`, `disk-key.mjs` and `wifi-record.mjs`; its notice file said `No bundled npm packages.`; `node -e "import(…)"` of the bundle printed `network.read {"actor":{"source":"server"}} till`. The image's build stage copies the whole tree (`deploy/Dockerfile:24-25`, `WORKDIR /src`, `COPY . .`) and `.dockerignore` leaves `scripts/` in; no image was built.
   - g. Every root guard: `pnpm exec vitest run scripts/*.test.ts scripts/*.test.mjs` printed `Test Files  1 failed | 115 passed (116)`, `Tests  1 failed | 9808 passed (9809)`. The one failure: `scripts/root-scope-consumers.test.mjs > ROOT_SCOPE_CONSUMERS > lists exactly the member directories that name, or whose CI test job runs, each root scripts/ file`, wanting `"scripts/box/host-protocol.mjs" => ["apps/server"]`. With that entry added to `ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs` (reverted after), `root-scope-consumers`, `changed-scope` and `changed-packages` tests printed `Tests  258 passed (258)`.
   - h. CI's package selection, through `scopeForPaths` in `scripts/changed-packages.mjs` with that entry: `scripts/box/host-protocol.mjs` selected `@waitron/server`; `scripts/box/wifi-record.mjs` and `scripts/box/name-tag.mjs` alone selected none (`kind: "root"`). `deploy/box/waitron-box.sh` is `kind: "global"` (everything runs).
7. **`scripts/comments-only.mjs:57-58`** says "Types written as JSDoc are dropped too: no tsconfig here sets `checkJs` or `allowJs`, so no tool reads them." Turning `allowJs` on for `apps/server` (6b) would make that false for `scripts/box/`: a JSDoc edit there would change the server's typecheck while that tool reports it as comments only.
8. **Moving the module into a workspace package drags the box tree with it.** Of the five modules `host-protocol.mjs` reaches, `upgrades/contracts.mjs` is imported by fifteen other `scripts/box/` modules (ten in `scripts/box/` itself and the other five in `upgrades/`), `name-tag.mjs` by `installer-policy.mjs`, and `wifi-record.mjs` by `wifi-boot-copy.mjs` (`git grep -n "from \"\./" -- 'scripts/box/*.mjs' 'scripts/box/**/*.mjs'`). The parent plan runs these on the host as plain `.mjs` files under a pinned host Node, with "No new workspace package … assumed" (parent "Tech Stack").
9. **A shell-only box breaks the connection after answering a long line, on Linux.** Measured on 2026-11-06 in `docker run --rm node:26.11.1-slim` (kernel `7.0.14-linuxkit`) with `/tmp/b3p8-linux/run.mjs`: a Node server accepts with `pauseOnConnect`, spawns the real `deploy/box/waitron-box.sh` with the connection as its standard input and output (standing in for systemd's `Accept=yes`; systemd itself was not run), and destroys the connection when the handler exits; a raw client records its events. Three rounds, the same each time: a 700-character line got `data:40` then `end`, the text `{"ok":false,"reason":"unknown_request"}\n`; lines of 701, 1003, 3142 and 4096 characters got `data:40` then `error:ECONNRESET` and no `end`, the 40 bytes being the whole `{"ok":false,"reason":"request_invalid"}\n`. The same script on this Mac (`/bin/bash` 3.2.57) gave `data:40` then `end` for every length, two rounds. The clock client's `exchange` answers `lost` on any error after connecting (finding 1), so on a Linux box it would drop that complete reply.
10. **Connecting to a socket file of mode `000`** on this Mac answered `error EACCES` (uid 503, a temp path of 67 characters, under macOS's 104-byte limit for a socket path). CI's server tests run on the runner itself, not in a container (`.github/workflows/ci.yml` has no `container:` key).
11. **Baselines, 2026-11-06:** `pnpm exec vitest run scripts/box/host-protocol.test.mjs` printed `Tests  525 passed (525)`; `scripts/root-scope-consumers.test.mjs` 26 tests; `pnpm --filter @waitron/server exec vitest run src/box-host-client.test.ts` printed `Tests  31 passed (31)`, and its one-file coverage run (execution notes) printed 100% of 72 statements, 57 branches, 13 functions, 70 lines.
12. **A type-level assertion is checked by the server's typecheck, not by Vitest.** A throwaway test with `expectTypeOf<"dashboard" | "till">().toEqualTypeOf<"dashboard" | "till" | "setup">()` made `pnpm exec tsc --noEmit` in `apps/server` fail with `TS2344`, exit 1, while `vitest run` of the same file printed `Tests  1 passed (1)`; with the unions equal, tsc exited 0. `expectTypeOf` is already used in `apps/server/src/order-groups.test.ts`.
13. **A declared export the module lacks is caught only by the bundler.** On 2026-11-06 a throwaway ambient declaration naming `NOT_THERE` beside `formatHostRequest`, imported by a throwaway server file and test: `pnpm exec tsc --noEmit` exited 0; `vitest run` printed `Tests  1 passed (1)` with `NOT_THERE` imported as `undefined`; `pnpm exec node ../../scripts/bundle-node.mjs` exited 1 with `No matching export in "../../scripts/box/host-protocol.mjs" for import "NOT_THERE"`. The first try named the declaration `zz-probe.d.ts` beside `zz-probe.ts`, and TypeScript ignored it (`TS7016` again): a `.d.ts` that shares its base name with a `.ts` in the same folder is read as that file's declaration, so `box-scripts.d.ts` must have no `box-scripts.ts` beside it.

## Decisions

- **D1. Import the module; describe its types in the server.** *Answer any to override (FYI).* `box-host-client.ts` imports `formatHostRequest`, `parseHostReply` and `HOST_REPLY_MAX` from `../../../scripts/box/host-protocol.mjs`, and `apps/server/src/box-scripts.d.ts` declares, for the server's typecheck, exactly the exports the server uses. The three choices box.md named, weighed by experiment:
  - *Import* works end to end: Vitest runs it, esbuild inlines it into the bundle and the probe bundle's notice file listed no npm package, ESLint and every root guard but one accept it, and that one guard is satisfied by one entry (finding 6e–6g). The cost is TypeScript (6a): it needs either `allowJs` with the server's root folder widened to the repository (6b), which would make `comments-only.mjs`'s JSDoc claim false (finding 7) and widen the server's whole program for one import, or a declaration (6c, 6d). The declaration goes in the server (6d) rather than beside the module (6c): an edit to a file under `apps/server/` selects the server's typecheck in CI, and an edit to a root `scripts/` file the server does not import by name selects nothing (6h). The declaration is a hand copy of the module's signatures that TypeScript cannot check against the JavaScript; the client's tests call the real functions, so a renamed or reshaped function fails them at run time when it is called, and Task 5 holds every value list. A declared export the module does not have passes the typecheck and Vitest (it imports as `undefined`) and is refused only by the bundler (finding 13), so a signature in the declaration is held by the cases that call it and by any bundling of the server, not by the typecheck.
  - *Moving it into a workspace package* would take five modules shared with the rest of the box tree, which runs on the host as plain `.mjs` files (finding 8), and a new package must be named in the root guards' shard lists and hold the coverage bar from its first commit (CLAUDE.md §2).
  - *A TypeScript twin held by a shared test* would copy the request writer and every reply rule (`host-protocol.mjs` is 466 lines), so server and host would judge by two copies, which is what PR 7 built `parseHostReply` to avoid ("so the later server client can check what it receives with the same rules", PR 7 Goal).
  The bundle carries every module the import reaches, the host-side file writers in `disk-key.mjs` and `wifi-boot-copy.mjs` included (6f), though nothing in the server calls them.
- **D2. A second factory, `boxHostRequests()`, beside `boxHostClient()`, in the same file.** PR 7's D1 names `box-host-client.ts` as the one client file. A new interface rather than new methods on `BoxHostClient`, because three boot tests build that interface as object literals (finding 1) and would each need seven fakes; the routes pull request builds this one in `boot.ts`. Per-request methods replace the parent's generic `boxHostCall<T>` (line 174): a generic `T` is a type the caller picks with nothing checking it, where a method per request gives each answer its own type.
- **D3. The answer.** *Answer any to override (FYI).* Every method resolves with one of:

  ```ts
  | ({ available: true } & Value)                                  // the reply's fields, as the clock client spreads its own
  | { available: false; reason: "refused"; refusal: Refusal }       // the host's own word, from that request's list
  | { available: false; reason: "unsupported"; detail: "unknown_request" | "request_invalid" }
  | { available: false; reason: "missing"; detail: string }         // no connection: the error code, ENOENT or EACCES
  | { available: false; reason: "lost" | "timeout" | "malformed" | "invalid" }
  ```

  `missing`, `lost`, `timeout` and `malformed` mean what they mean for the clock client (finding 1). `unsupported` is this client's word for "the host does not take this request"; `detail` keeps the host's own word so a later log can tell the two cases apart (D4). `invalid` means `formatHostRequest` refused the request, so nothing was sent; the clock client calls its own unsendable request `malformed` (`box-host-client.ts:152-153`), but here that word already means a bad reply, and a caller should be able to tell its own fault from the host's. The host's parser refusals other than `unknown_request` (`request_invalid` to a short line, `actor_invalid`, `fields_invalid`) and `host_failed` are refusals, each named, since each means the server and host disagree or the host failed, and the routes pull request decides how to show them.
- **D4. A shell-only box's `request_invalid`.** A reply of `request_invalid` to a line longer than 700 characters reads as `{reason:"unsupported", detail:"request_invalid"}`; to a line of 700 or fewer, as the refusal `request_invalid`. Reason: the shell handler answers `request_invalid` to any line over 700 before it reads the request's name (finding 2), and B3 lines reach 3142 (finding 4). The same reading serves a host that lags the server after an app update and refuses a longer line it does not know. Tested against the real shell handler at 700 and 701 characters (Task 4).
- **D5. A complete reply before a broken connection is the answer, for B3's requests only.** *Answer any to override (FYI).* When the connection breaks (an error after connecting) and what arrived before is non-empty and ends in a newline, the client reads that text as the reply; anything else is `lost`. Reason: finding 9: on Linux, a shell-only box answers every B3 line over 700 characters with a whole reply followed by a reset, so without this rule D4 could never be seen on a real box. The reply is still checked whole by `parseHostReply`, so a reply cut mid-line is `lost`, and two lines are `malformed`. The clock client keeps answering `lost` there (the task's constraint, and Review Focus 1); its lines stay under 700 characters (its requester is capped at 512 bytes, `box-host-client.ts:39`, `:152`), so the shell reads them whole, but whether it should follow is left to the backlog rather than changed unasked.
- **D6. How long each request waits.** *Answer any to override (FYI).* `network.read` and `screen.read` wait `DEFAULT_HOST_READ_MS = 5_000`; `network.scan`, `network.join`, `network.forget`, `screen.set` and `tag.write` wait `DEFAULT_HOST_CHANGE_MS = 20_000`. Both can be set through `deps` (`readMs`, `changeMs`), as the clock client's can. Reasons:
  - 20 seconds for anything that may change the box, as the clock set's 20 seconds: longer than `RuntimeMaxSec=15` (finding 2), so the client never reports `timeout` while this connection's host instance may still start a change; the host is stopped first and the client sees `lost`. PR 7's D8 has a join or forget answer once started, so a healthy one returns well inside this.
  - The scan waits as long because how long a scan takes on the box's radio is not measured (PR 7, "Not measured"), and a wait shorter than the host's own limit could cut a scan the host would finish.
  - 5 seconds for the two reads is a chosen bound, not a measurement: a forwarded read crosses the shell handler and the Node host, a step nobody has timed; the clock status's 2 seconds leaves less room for it, and a read slower than 5 seconds is of no use to a screen that re-reads while a change runs (PR 7 D8). The forwarding pull request measures a forwarded read and revises this.
  - If the Node host turns out to run as its own long-lived service, stopping the shell's instance at 15 seconds would no longer stop a change; the forwarding pull request owns that (Out).
- **D7. The reply limit.** The client stops reading past `HOST_REPLY_MAX` (4096) bytes, newline included, and answers `malformed`, as the clock client does past its own 4096 (finding 1). PR 7 sized its largest reply, 32 networks, at 3641 bytes with the newline (its D13). The limit is inclusive: 4096 bytes with no end yet keeps waiting.
- **D8. The actor.** Methods take `HostActor = {source:"person"; person: string} | {source:"server"}`, typed per request as PR 7's D6 allows: `networkRead` and `screenRead` take either; `networkScan`, `networkJoin`, `networkForget` and `screenSet` take a person; `tagWrite` takes none and sends `{source:"server"}` itself, the only actor `tag.write` accepts. The client passes the caller's objects to `formatHostRequest` as they are, so an object carrying any key the protocol does not name answers `invalid` (its exact-key rule), which TypeScript's types cannot rule out.
- **D9. The server's types are held to the protocol's lists.** *Answer any to override (FYI).* `host-protocol.mjs` exports, frozen (inner lists too), the eight lists its reply rules already use (finding 3), with no change to what any function answers. A server test holds each TypeScript union both ways: the union equals a literal list in the test (checked by the server's typecheck, finding 12), and that literal list equals the module's exported list (checked at run time). The same for `WIFI_NO_COPY_REASONS`, `WIFI_COPY_STATES` and `WIFI_COPY_FAILURES`, already exported. So a value added on the host side fails the server's tests until the server's types name it. Not held this way: `keyMgmt` (`"wpa-psk" | "sae"`), which no module exports as a list (Task 3 sends both and has `"wpa-eap"` refused), and `host_failed`, which the module writes as a fixed line and exports in no list, so the test names it as a literal.
- **D10. The password.** `networkJoin` hands the caller's `psk` to `formatHostRequest` and writes the resulting line; the line is not kept after it is written, the client writes nothing to the console, and no answer is built from the request. A reply that names the password (a host fault) is `malformed`, and the client never puts reply text in an answer except through `parseHostReply`'s checked value.
- **D11. CI selects the server's tests for the modules it names.** Each root `scripts/` file a server file imports gets its `ROOT_SCOPE_CONSUMERS` entry (`scripts/changed-scope.mjs`), as `scripts/root-scope-consumers.test.mjs` demands (finding 6g): `host-protocol.mjs` (Task 2), `wifi-record.mjs` and `wifi-boot-copy.mjs` (Task 5, whose test imports their lists). The guard counts only files a member names, and fails an entry for anything else, so `name-tag.mjs`, `upgrades/contracts.mjs` and `disk-key.mjs`, reached only through `host-protocol.mjs`, select no package when they alone change (finding 6h; the guard's own header states this gap). Their own root tests still run. Recorded in the backlog (Task 6).

## Execution notes for every task

- Work in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-8-host-client`, branch `feat/b3-8-host-client`. Every command below runs from that folder.
- Server focused command: `pnpm --filter @waitron/server exec vitest run src/<file> [src/<file> …]`, naming each file (zsh would expand a glob in the wrong folder). Root focused command: `pnpm exec vitest run scripts/<path>`. A run with no `Tests` count is no evidence; read the count.
- Server typecheck: `pnpm --filter @waitron/server typecheck` (about 12 seconds here). Vitest does not typecheck, so a type-level assertion is proven only by this (finding 12).
- Server one-file coverage: `pnpm --filter @waitron/server exec vitest run src/box-host-client.test.ts src/box-host-client.requests.test.ts … --coverage --coverage.include=src/box-host-client.ts --coverage.reportsDirectory="$(mktemp -d)"`, naming every test file that exists by then. Read the four summary lines; each should be 100% or the gap named to the reviewer. Root one-file coverage: `pnpm exec vitest run scripts/box/host-protocol.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/host-protocol.mjs`.
- The clock guard, after every server task: `pnpm --filter @waitron/server exec vitest run src/box-host-client.test.ts` prints `Tests  31 passed (31)`, and `git diff --exit-code main -- apps/server/src/box-host-client.test.ts` prints nothing.
- Before each commit: `pnpm exec prettier --check <changed files>` and `pnpm exec eslint <changed code files>`.
- Every expected value in a test is a literal written in the test: each request line and each reply line as a string literal (with `\\u00e9` for an escape on the wire), never built with `JSON.stringify` or the module under test, except where a step says otherwise.
- Shared test values: `PERSON = { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" } as const`, `SERVER = { source: "server" } as const`.
- **Deletion controls:** remove the named check, run the focused command, confirm the named test fails for that reason (read the message), restore, and report each control's failing test name in the handover. Commit none of them.
- The fake host binds a socket at `mkdtemp(join(tmpdir(), "box-host-"))/box.sock`, as the clock tests do; such a path was 67–73 characters here, under macOS's 104-byte limit (finding 10).
- Stop only what a test started: the helper records each server and each spawned handler and closes or kills exactly those.

### Task 1: export the reply value lists from the host protocol

**Files:** modify `scripts/box/host-protocol.mjs`, `scripts/box/host-protocol.test.mjs` (new cases only).

**Interface (only additions; no function's answer changes):**

```js
export const START_SCREENS;   // already frozen: ["dashboard", "till"]
export const PARSER_REFUSALS; // frozen: ["request_invalid", "unknown_request", "actor_invalid", "fields_invalid"]
export const REPLY_REFUSALS;  // frozen, and each inner list frozen; same keys and values as today
export const CHANGE_KINDS;    // frozen: ["join", "forget"]
export const CHANGE_STATES;   // frozen: ["running", "applied", "refused"]
export const CHANGE_REFUSALS; // frozen, inner lists frozen: { join: ["password-rejected", "network-not-found", "timed-out", "failed"], forget: ["failed"] }
export const SCAN_SECURITY;   // frozen: ["wpa-psk", "sae", "other"]
export const TAG_OUTCOMES;    // frozen: ["written", "removed", "unchanged"]
```

- [ ] **Step 1: Write the failing tests.** One case per list: `toEqual` the literal above (for `REPLY_REFUSALS`, the literal object `{"network.read": [], "network.scan": ["busy","no_wifi"], "network.join": ["busy","no_wifi"], "network.forget": ["busy","not_saved"], "screen.read": [], "screen.set": [], "tag.write": ["busy","no_free_token","header_unreadable","no_space"]}`), and only after that, in the same case, `Object.isFrozen` of the list and of each inner list (a frozen check alone passes on `undefined`, PR 7's R11).
- [ ] **Step 2:** Run `pnpm exec vitest run scripts/box/host-protocol.test.mjs`. Expected: the eight new cases fail with `expected undefined to deeply equal …` (a missing named export imports as `undefined`, PR 7's finding 17); the 525 existing cases pass.
- [ ] **Step 3: Implement.** Add `export` to the eight constants; wrap the four unfrozen arrays and the inner arrays of `REPLY_REFUSALS` and `CHANGE_REFUSALS` in `Object.freeze`. Nothing else changes.
- [ ] **Step 4:** Focused command green (above 525, none changed); root one-file coverage read; prettier and eslint clean.
- [ ] **Step 5: Deletion controls.** Remove one at a time: the freeze on `CHANGE_KINDS` (its case fails on `isFrozen`); the freeze on `REPLY_REFUSALS["tag.write"]` (the inner-list check fails).
- [ ] **Step 6: Commit:** `git add scripts/box/host-protocol.mjs scripts/box/host-protocol.test.mjs && git commit -s -m "feat(box): export the host protocol's reply value lists"`.

### Task 2: the shared reader, `networkRead`, and every failure word

**Files:** modify `apps/server/src/box-host-client.ts` (its header comment, lines 3–11, describes the clock service alone: rewrite it to name both clients, keeping its definitions of `missing` and `lost`), `scripts/changed-scope.mjs`; create `apps/server/src/box-scripts.d.ts`, `apps/server/src/testing/fake-box-host.ts`, `apps/server/src/box-host-client.requests.test.ts`.

**Interface:**

```ts
// box-scripts.d.ts: TypeScript reads no types from a .mjs file without allowJs.
declare module "*/scripts/box/host-protocol.mjs" {
  export const HOST_REPLY_MAX: number;
  export function formatHostRequest(request: {
    verb: string;
    fields: Readonly<Record<string, unknown>>;
    actor: Readonly<Record<string, unknown>>;
  }): string;
  export function parseHostReply(
    verb: string,
    text: unknown,
  ):
    | Readonly<{ kind: "ok"; value: Readonly<Record<string, unknown>> }>
    | Readonly<{ kind: "refused"; reason: string }>
    | Readonly<{ kind: "malformed" }>;
}

// box-host-client.ts, added (the clock client's exports unchanged):
export type HostActor = { source: "person"; person: string } | { source: "server" };
export type PersonActor = Extract<HostActor, { source: "person" }>;
export type ProtocolRefusal = "request_invalid" | "actor_invalid" | "fields_invalid" | "host_failed";
export type HostUnavailable<Refusal extends string> =
  | { available: false; reason: "refused"; refusal: Refusal }
  | { available: false; reason: "unsupported"; detail: "unknown_request" | "request_invalid" }
  | { available: false; reason: "missing"; detail: string }
  | { available: false; reason: "lost" | "timeout" | "malformed" | "invalid" };
export type HostAnswer<Value extends object, Refusal extends string> =
  | ({ available: true } & Value)
  | HostUnavailable<Refusal>;

export type WifiCopyState = "pending" | "current" | "absent" | "failed";
export type WifiCopyFailure = "mount-unverified" | "root-changed" | "path-unsafe" | "permissions-unsafe" | "io-failed" | "publication-unverified";
export type WifiNoCopyReason = "cable-only" | "open" | "open-or-wep" | "dynamic-wep" | "owe" | "enterprise" | "unsupported-security" | "password-unavailable" | "password-not-printable" | "password-too-long" | "password-invalid";
export type JoinChangeRefusal = "password-rejected" | "network-not-found" | "timed-out" | "failed";
export type ForgetChangeRefusal = "failed";
export type NetworkChange =
  | { kind: "join"; ssidHex: string; state: "running" | "applied"; reason: null }
  | { kind: "join"; ssidHex: string; state: "refused"; reason: JoinChangeRefusal }
  | { kind: "forget"; ssidHex: string; state: "running" | "applied"; reason: null }
  | { kind: "forget"; ssidHex: string; state: "refused"; reason: ForgetChangeRefusal };
export interface NetworkSnapshot {
  wired: { connected: boolean; address: string | null };
  wifi: { connectedSsidHex: string | null; savedSsidHex: string | null };
  change: NetworkChange | null;
  bootCopy: { state: WifiCopyState; reason: WifiNoCopyReason | null; failure: WifiCopyFailure | null };
}
export interface BoxHostRequests {
  networkRead(actor: HostActor): Promise<HostAnswer<NetworkSnapshot, ProtocolRefusal>>;
  // Task 3 adds the other six.
}
export const DEFAULT_HOST_READ_MS = 5_000;
export function boxHostRequests(
  deps?: { socketPath?: string; readMs?: number; changeMs?: number },
): BoxHostRequests;
```

The reader, private, which both clients use:

```ts
type Received =
  | { ok: true; text: string }                          // the connection ended; text may be ""
  | { ok: false; reason: "missing"; detail: string }    // an error before connecting
  | { ok: false; reason: "lost"; text: string }         // an error after connecting; what arrived before it
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "oversize" };                  // more than maxBytes arrived; reading stopped
function sendLine(socketPath: string, line: string, limitMs: number, maxBytes: number): Promise<Received>;
```

`exchange` (the clock client's) becomes `sendLine(…, MAX_REPLY_BYTES)` followed by its existing checks, mapping `lost` to `lost` whatever text arrived, `oversize` to `malformed`, and `ok` with `""` to `lost`, so its answers are the same in every case (Review Focus 1). The B3 path, one private function `request(verb, fields, actor, limitMs)`:

1. `formatHostRequest({verb, fields, actor})` inside `try`; a throw of anything → `{available:false, reason:"invalid"}`, with no connection made.
2. `sendLine(socketPath, line, limitMs, HOST_REPLY_MAX)`: `missing` → `{reason:"missing", detail}`; `timeout` → `timeout`; `oversize` → `malformed`; `lost` → `lost` (Task 4 adds D5's reading here); `ok` with `""` → `lost`.
3. `parseHostReply(verb, text)`: `ok` → `{available:true, ...value}`; `refused` with `unknown_request` → `{reason:"unsupported", detail:"unknown_request"}`; any other `refused` → `{reason:"refused", refusal}` (Task 4 adds D4 here); `malformed` → `malformed`.

The fake host, `src/testing/fake-box-host.ts` (under `src/testing/`, so outside coverage, `apps/server/vitest.config.ts`'s `exclude`):

```ts
export interface FakeBoxHost { path: string; lines: string[]; connections(): number }
/** `reply` gets each line the client sends, without its newline, and the connection. */
export function fakeBoxHost(reply: (line: string, socket: Socket) => void): Promise<FakeBoxHost>;
/** Writes `text` exactly and ends the connection. */
export function answer(text: string): (line: string, socket: Socket) => void;
/** A socket path in a fresh temp folder where nothing listens. */
export function noBoxHostPath(): string;
/** Closes every server, connection and temp folder this module made; call in afterEach. */
export function closeFakeBoxHosts(): Promise<void>;
```

Its line reading copies the clock test's `host()` (`box-host-client.test.ts:20-46`), plus a connection count; the clock test itself is not changed.

- [ ] **Step 1: Write the fake host and the failing tests.** First `src/testing/fake-box-host.ts` as specified above, so the test file loads and fails on the missing client rather than on a missing helper; then `box-host-client.requests.test.ts`, each case with a fake host unless named:
  - **The line.** `networkRead(PERSON)` sends exactly `network.read {"actor":{"source":"person","person":"0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11"}}`; `networkRead(SERVER)` sends `network.read {"actor":{"source":"server"}}`; one connection per call.
  - **A typed snapshot.** The reply `{"ok":true,"wired":{"connected":true,"address":"192.168.1.10"},"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null}}\n` answers `toEqual` `{available:true, wired:{connected:true,address:"192.168.1.10"}, wifi:{connectedSsidHex:"4361666550657065", savedSsidHex:"4361666550657065"}, change:null, bootCopy:{state:"current",reason:null,failure:null}}`. A second: wired `{"connected":false,"address":null}`, `change` `{"kind":"join","ssidHex":"4361666550657065","state":"refused","reason":"password-rejected"}`, `bootCopy` `{"state":"failed","reason":null,"failure":"io-failed"}`.
  - **Refusals.** Replies `request_invalid`, `actor_invalid`, `fields_invalid`, `host_failed` each answer `{available:false, reason:"refused", refusal:<it>}` (the line sent is 90 characters, under 700). `unknown_request` answers `{available:false, reason:"unsupported", detail:"unknown_request"}`. `busy`, which `network.read` may not answer (PR 7 D14), answers `{available:false, reason:"malformed"}`.
  - **Malformed replies**, each `{available:false, reason:"malformed"}`: `nope\n`; the valid snapshot without its newline; the valid snapshot followed by `\n` again; ending `\r\n`; with `wired` and `wifi` swapped in order; with an extra top-level key `"psk":"x"`; 4096 bytes of `x` then the end (the reader's limit passed, `parseHostReply` refuses).
  - **The byte limit.** A host that writes 4097 bytes of `x` and never ends: answers `malformed` in under 1000 ms with `readMs: 5000`, and the host sees the connection close (poll for it, as the clock test does). A host that writes exactly 4096 bytes and never ends: answers `timeout` at `readMs: 300` (the limit is inclusive, D7).
  - **Lost.** A host that ends with nothing written; a server that destroys each connection as it arrives (as the clock test's "drops the connection" case): both `{available:false, reason:"lost"}`.
  - **Missing.** `noBoxHostPath()`: `{available:false, reason:"missing", detail:"ENOENT"}` in under 50 ms. A fake host whose socket file is then `chmodSync(path, 0o000)`: `{available:false, reason:"missing", detail:"EACCES"}` (finding 10; run as root, this case fails rather than passes).
  - **Timeout.** A host that never answers, `readMs: 200`: `{available:false, reason:"timeout"}`, after at least 190 ms and under 1000 ms.
  - **Invalid, never sent.** `networkRead({source:"person", person:"a b"} )`, `networkRead({source:"server", person:"p1"} as never)`, and an actor whose `source` is a getter that throws: each `{available:false, reason:"invalid"}`, and the fake host's `connections()` is 0.
  - **Defaults.** `DEFAULT_HOST_READ_MS` is `5_000`; `boxHostRequests({ readMs: 200 }).networkRead(SERVER)` answers `missing` (no machine running this suite has the box's service, as the clock test's default-path case says).
  - **Never throws, writes nothing.** Spy the six console methods (`log`, `info`, `warn`, `error`, `debug`, `trace`) before each case and assert none was called after it.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/box-host-client.requests.test.ts`. Expected: every case fails with `TypeError: … boxHostRequests is not a function` or `expected undefined to be 5000` (PR 7's finding 17, measured in the root project on the same Vitest).
- [ ] **Step 3: Implement** the interface above: `sendLine` from `exchange`'s socket code, `exchange` on top of it unchanged in what it answers, the import of `../../../scripts/box/host-protocol.mjs`, `request()`, `boxHostRequests` with `networkRead` using `deps.readMs ?? DEFAULT_HOST_READ_MS`.
- [ ] **Step 4: Typecheck red, then green.** Run `pnpm --filter @waitron/server typecheck` before adding `box-scripts.d.ts`: expected `error TS7016: Could not find a declaration file for module '../../../scripts/box/host-protocol.mjs'` (finding 6a). Add the declaration; typecheck exits 0.
- [ ] **Step 5: The root-scope guard red, then green.** Run `pnpm exec vitest run scripts/root-scope-consumers.test.mjs`: expected the "lists exactly the member directories …" case fails wanting `"scripts/box/host-protocol.mjs" => ["apps/server"]` (finding 6g). Add `["scripts/box/host-protocol.mjs", ["apps/server"]],` to `ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs`; rerun with `scripts/changed-scope.test.mjs scripts/changed-packages.test.mjs` beside it: all green.
- [ ] **Step 6:** Focused command green; the clock guard (execution notes); server one-file coverage over both test files read; prettier and eslint clean on every changed file, the `.d.ts` included.
- [ ] **Step 7: Deletion controls.** Remove one at a time: the `try` around `formatHostRequest` (the throwing-getter case rejects); the `unknown_request` mapping (that case answers `refused`); the B3 call's own byte limit, passing `Infinity` instead of `HOST_REPLY_MAX` to `sendLine` from `request()` (the 4097-byte case answers `timeout`; removing the check inside `sendLine` instead would also fail the clock case "answers malformed, and stops reading, for a reply over 4 KiB", `box-host-client.test.ts:138-149`, since both clients share it); `HOST_REPLY_MAX` replaced by `HOST_REPLY_MAX - 1` (the 4096-byte case answers `malformed`, not `timeout`); the empty-text-to-`lost` mapping on the B3 path (the ends-with-nothing case answers `malformed`). After each, also run the clock guard: the clock tests must not be the ones failing, since only the B3 path changed.
- [ ] **Step 8: Commit:** `git add apps/server/src/box-host-client.ts apps/server/src/box-scripts.d.ts apps/server/src/testing/fake-box-host.ts apps/server/src/box-host-client.requests.test.ts scripts/changed-scope.mjs && git commit -s -m "feat(server): read the box host's network state through the shared protocol"`.

### Task 3: the other six requests

**Files:** modify `apps/server/src/box-host-client.ts`, `apps/server/src/box-host-client.requests.test.ts`.

**Interface (added to `BoxHostRequests`):**

```ts
export type StartScreen = "dashboard" | "till";
export type ScanSecurity = "wpa-psk" | "sae" | "other";
export interface ScannedNetwork { ssidHex: string; signal: number; security: ScanSecurity }
export interface WifiJoin { ssidHex: string; keyMgmt: "wpa-psk" | "sae"; psk: string; hidden: boolean }
export type NameTag = { name: string; live: boolean } | null;
export type TagOutcome = "written" | "removed" | "unchanged";
export type NetworkScanRefusal = ProtocolRefusal | "busy" | "no_wifi";
export type NetworkJoinRefusal = ProtocolRefusal | "busy" | "no_wifi";
export type NetworkForgetRefusal = ProtocolRefusal | "busy" | "not_saved";
export type TagWriteRefusal = ProtocolRefusal | "busy" | "no_free_token" | "header_unreadable" | "no_space";
export const DEFAULT_HOST_CHANGE_MS = 20_000;

networkScan(actor: PersonActor): Promise<HostAnswer<{ networks: readonly ScannedNetwork[] }, NetworkScanRefusal>>;
networkJoin(join: WifiJoin, actor: PersonActor): Promise<HostAnswer<Record<never, never>, NetworkJoinRefusal>>;
networkForget(forget: { ssidHex: string }, actor: PersonActor): Promise<HostAnswer<Record<never, never>, NetworkForgetRefusal>>;
screenRead(actor: HostActor): Promise<HostAnswer<{ start: StartScreen }, ProtocolRefusal>>;
screenSet(set: { start: StartScreen }, actor: PersonActor): Promise<HostAnswer<{ start: StartScreen }, ProtocolRefusal>>;
tagWrite(tag: NameTag): Promise<HostAnswer<{ tag: TagOutcome }, TagWriteRefusal>>; // sends {source:"server"}
```

`screenRead` waits `readMs`; the other five wait `deps.changeMs ?? DEFAULT_HOST_CHANGE_MS` (D6). `networkJoin`, `networkForget` and `screenSet` pass the caller's object as `fields`; `tagWrite` passes `{ tag }`.

- [ ] **Step 1: Write the failing tests.** Every request line in this task is under 700 characters (Task 4 owns the longer ones).
  - **Lines,** each exactly: `network.scan {"actor":{"source":"person","person":"0b9c…0a11"}}`; `network.join {"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false,"actor":{…person…}}`; the same with `"keyMgmt":"sae"` and `"hidden":true`; `network.forget {"ssidHex":"4361666550657065","actor":{…person…}}`; `screen.read {"actor":{"source":"server"}}`; `screen.set {"start":"till","actor":{…person…}}`; `tag.write {"tag":null,"actor":{"source":"server"}}`; `tag.write {"tag":{"name":"Caf\u00e9 Pepe","live":true},"actor":{"source":"server"}}` (the six characters `\u00e9` on the wire; in the test literal `"Caf\\u00e9 Pepe"` or `String.raw`) for the name `Café Pepe` (finding 4 printed these). Write the person id out in full in the test.
  - **Typed answers:** scan `{"ok":true,"networks":[{"ssidHex":"4361666550657065","signal":71,"security":"wpa-psk"},{"ssidHex":"ff","signal":0,"security":"other"}]}\n` → `{available:true, networks:[…both…]}`, and `{"ok":true,"networks":[]}\n` → `networks: []`; join and forget `{"ok":true}\n` → exactly `{available:true}`; `screenRead` and `screenSet` `{"ok":true,"start":"till"}\n` → `{available:true, start:"till"}`; `tagWrite` with each of `written`, `removed`, `unchanged`.
  - **Each request's own refusals** → `refused` with that word: scan `busy`, `no_wifi`; join `busy`, `no_wifi`; forget `busy`, `not_saved`; `tagWrite` `busy`, `no_free_token`, `header_unreadable`, `no_space`. **The protocol's four** (`request_invalid`, `actor_invalid`, `fields_invalid`, `host_failed`) → `refused` for each of the six methods. **Another request's word** → `malformed`: `not_saved` from join, `no_wifi` from forget, `busy` from `screenSet`.
  - **`unknown_request` for that request only.** A host answering `unknown_request` to lines starting `network.scan ` and the valid snapshot to `network.read `: `networkScan` → `{reason:"unsupported", detail:"unknown_request"}`; then `networkRead` → `available: true`; then `networkScan` again → `unsupported`; three connections.
  - **Invalid, never sent** (`connections()` stays 0, each `{available:false, reason:"invalid"}`): join `keyMgmt` `"wpa-eap"` (cast); join `psk` `"abcdefg"` (7 characters); join with an extra key `note: "x"` (D8); forget `ssidHex` `"FF"`; `screenSet` `start` `"Panel"` (cast); `tagWrite({name:"", live:true})`; `tagWrite({name:"Cafe\u0301", live:true})` (an `e` and a combining acute accent, written as that escape in the test) (decomposed, which `usableVenueName` changes); `tagWrite({name:"Bar", live:true, extra:1} as never)`; `networkScan(SERVER as never)`.
  - **Waits.** A host that never answers: with `changeMs: 200`, each of the five changing methods answers `timeout` after at least 190 ms and under 1000 ms; `screenRead` with `readMs: 200, changeMs: 5000` answers `timeout` under 1000 ms; `networkScan` with `readMs: 200, changeMs: 600` answers after at least 590 ms. `DEFAULT_HOST_CHANGE_MS` is `20_000` and greater than `15_000`.
  - **Canary sweep.** `CANARY = "Canary-psk-7f3a91"`; `networkJoin({ssidHex:"4361666550657065", keyMgmt:"wpa-psk", psk: CANARY, hidden:false}, PERSON)` against hosts answering: `{"ok":true}\n`; `{"ok":false,"reason":"busy"}\n`; `{"ok":true,"psk":"Canary-psk-7f3a91"}\n`; `{"ok":false,"reason":"Canary-psk-7f3a91"}\n`; nothing (end); and once with `keyMgmt: "wpa-eap"`. In every run: `JSON.stringify(answer)` holds no `Canary-psk-7f3a91`; the answer is exactly the expected one (`{available:true}`, `refused busy`, `malformed`, `malformed`, `lost`, `invalid`); the host's recorded line holds the canary exactly once (`line.split(CANARY).length === 2`) in the five sent runs and no line is recorded in the `invalid` run; no console method was called.
- [ ] **Step 2:** Run the focused command on `src/box-host-client.requests.test.ts`. Expected: the new cases fail with `TypeError: client.networkScan is not a function` (and the like for the others) and `expected undefined to be 20000`; Task 2's cases pass.
- [ ] **Step 3: Implement** the six methods on `request()`.
- [ ] **Step 4:** Focused command green; typecheck; the clock guard; one-file coverage; prettier and eslint clean.
- [ ] **Step 5: Deletion controls.** Remove one at a time: `tagWrite`'s server actor (send none: every `tagWrite` case answers `invalid`); `screenRead`'s use of `readMs` (use `changeMs`: its wait case fails); the scan's use of `changeMs` (use `readMs`: its 590 ms case fails).
- [ ] **Step 6: Commit:** `git add apps/server/src/box-host-client.ts apps/server/src/box-host-client.requests.test.ts && git commit -s -m "feat(server): ask the box host to scan, join, forget, set the screen and write the name tag"`.

### Task 4: a shell-only box, and a reply before a broken connection

**Files:** modify `apps/server/src/box-host-client.ts`, `apps/server/src/testing/fake-box-host.ts`; create `apps/server/src/box-host-client.shell.test.ts`.

**Interface:** in `request()`: after `parseHostReply`, a `refused` `request_invalid` when `line.length > SHELL_LINE_MAX` (a private `700`, with a comment naming `deploy/box/waitron-box.sh`'s read) answers `{reason:"unsupported", detail:"request_invalid"}` (D4); after `sendLine`, a `lost` whose `text` is non-empty and ends in `"\n"` goes on to `parseHostReply` as if the connection had ended (D5). The clock path is unchanged.

The fake host module gains:

```ts
/** Each connection runs the real deploy/box/waitron-box.sh with the connection as its standard
 * input and output, as systemd's Accept=yes does; the connection closes when the handler exits. */
export function shellBoxHost(): Promise<{ path: string }>;
```

It accepts with `pauseOnConnect: true`, spawns `bash <repo>/deploy/box/waitron-box.sh test` (the path from `new URL("../../../../deploy/box/waitron-box.sh", import.meta.url)`) with `stdio: [socket, socket, "pipe"]`, environment `WAITRON_BOX_UPTIME` set to a temp file holding `12345.67 0\n` (so `/proc/uptime` is not needed on macOS) and `WAITRON_BOX_STATE_DIR` to a temp folder, destroys the connection when the child exits, and records each child so `closeFakeBoxHosts` kills any still running (by its handle, never by name). This is finding 9's arrangement.

- [ ] **Step 1: Write the failing tests** in `box-host-client.shell.test.ts`. A pass-through `vi.mock("node:net", …)` built with `importOriginal` (state through `vi.hoisted`): every export is the real one, except that `createConnection` returns the real socket and, only while a test sets `breakAfterFirstData`, adds a `once("data")` listener that calls `setImmediate(() => socket.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })))`. It is registered before the client's own listener, so the client still receives that chunk; this gives on any machine the data-then-reset order Linux gave in finding 9. For every socket it creates, with or without `breakAfterFirstData`, the stand-in also records how the socket ended, in creation order: `"end"` on its `end` event, or `"error:<code>"` on its `error` event, whichever comes first; adding these listeners changes nothing the client sees.
  - **The 700-character boundary, fake host.** Joins with `keyMgmt: "sae"`, SSID `4361666550657065`, `hidden: false`, `PERSON`, and `psk` 90 `é` plus `x` (700) or plus `xx` (701); and `tagWrite({name: "a" + "é".repeat(105), live: true})` (700) and `"aa" + …` (701) (finding 4). Assert each recorded line's length is the literal `700` or `701`. A host answering `request_invalid` to all: the 700-character ones answer `{reason:"refused", refusal:"request_invalid"}`, the 701-character ones `{reason:"unsupported", detail:"request_invalid"}`.
  - **A reply before a broken connection** (`breakAfterFirstData` on, the host writing its reply without ending): `networkRead` with the valid snapshot → `available: true` with that snapshot; the 701-character join with `{"ok":false,"reason":"request_invalid"}\n` → `unsupported`, `request_invalid`; the host writing `{"ok":tr` (no newline) → `lost`; the host writing two valid lines in one write → `malformed`. With `breakAfterFirstData` on and a host that writes nothing and destroys the connection → `lost`.
  - **The clock client keeps its answer.** `boxHostClient({socketPath}).clockStatus()` against a host that writes `{"ok":true,"service":"on","unit":"chrony.service","synchronised":false,"lastSyncAt":1793425000123,"nowMs":1793425411088}\n` without ending, with `breakAfterFirstData` on → `{available:false, reason:"lost"}` (D5; this passes before and after the change: it pins today's behaviour).
  - **The real shell handler** (`shellBoxHost()`, no `breakAfterFirstData`): each of the seven methods with Task 3's ordinary arguments → `{available:false, reason:"unsupported", detail:"unknown_request"}`; the 700-character join and tag → `detail:"unknown_request"`; the 701-character join and tag → `detail:"request_invalid"`; the 975-character join (`sae`, `psk` 128 `é`, `ssidHex` `"ff"` repeated 32 times, `hidden: false`, `PERSON`'s 36-character id; PR 7's 1003 used a 64-character id) and a `tagWrite` whose name is 256 copies of `😀` with `live: false` → `detail:"request_invalid"`. The handler's standard error, collected through its pipe, is empty in every case. **How each real connection ended:** every line of 700 characters or fewer ends `"end"` on both systems; each of the four lines of 701 or more ends `"error:ECONNRESET"` when `process.platform === "linux"` and `"end"` otherwise (finding 9: measured on Docker Desktop's `7.0.14-linuxkit` kernel and on macOS; CI's Ubuntu kernel was not measured, so its first run is that measurement, and a different ending there is a finding to report, not an assertion to loosen).
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/box-host-client.shell.test.ts`. Expected on this Mac: every 701-character and longer case answers `refused`, `request_invalid` instead of `unsupported`; the reply-before-break cases with a complete reply answer `lost`; the clock pin, the partial-reply, nothing-written and `unknown_request` cases pass.
- [ ] **Step 3: Implement** D4 and D5 in `request()` as above.
- [ ] **Step 4:** The shell test file and `src/box-host-client.requests.test.ts` green; typecheck; the clock guard; one-file coverage over all three test files; prettier and eslint clean.
- [ ] **Step 5: Deletion controls.** Remove one at a time: the 700-character rule (the 701 fake-host and real-handler cases answer `refused`); `>` changed to `>=` (the 700-character fake-host case answers `unsupported`); D5's reading (the stand-in's complete-reply-before-break cases answer `lost` on any machine; on this Mac the real-handler cases still pass, because macOS ends those connections cleanly, so only on Linux do the four long real-handler cases also fail); D5's "ends in a newline" condition (the `{"ok":tr` case answers `malformed`, not `lost`).
- [ ] **Step 6: Commit:** `git add apps/server/src/box-host-client.ts apps/server/src/testing/fake-box-host.ts apps/server/src/box-host-client.shell.test.ts && git commit -s -m "feat(server): read a box with only the clock handler as not taking B3's requests"`.

### Task 5: hold the server's types to the protocol's lists

**Files:** create `apps/server/src/box-host-client.types.test.ts`; modify `apps/server/src/box-scripts.d.ts`, `scripts/changed-scope.mjs`.

**Interface:** `box-scripts.d.ts` gains, inside the host-protocol declaration, `START_SCREENS`, `PARSER_REFUSALS`, `CHANGE_KINDS`, `CHANGE_STATES`, `SCAN_SECURITY`, `TAG_OUTCOMES` as `readonly string[]`, and `REPLY_REFUSALS`, `CHANGE_REFUSALS` as `Readonly<Record<string, readonly string[]>>`; and two more declarations: `"*/scripts/box/wifi-record.mjs"` with `WIFI_NO_COPY_REASONS: readonly string[]`, and `"*/scripts/box/wifi-boot-copy.mjs"` with `WIFI_COPY_STATES` and `WIFI_COPY_FAILURES` as `readonly string[]`.

- [ ] **Step 1: Write the tests.** For each pair below, a literal list `as const satisfies readonly <Union>[]`, an `expectTypeOf<(typeof LIST)[number]>().toEqualTypeOf<Union>()`, and `expect(<module list>).toEqual(LIST)`:
  - `StartScreen` ↔ `START_SCREENS`; `ScanSecurity` ↔ `SCAN_SECURITY`; `TagOutcome` ↔ `TAG_OUTCOMES`; `NetworkChange["kind"]` ↔ `CHANGE_KINDS`; `NetworkChange["state"]` ↔ `CHANGE_STATES`; `JoinChangeRefusal` ↔ `CHANGE_REFUSALS.join`; `ForgetChangeRefusal` ↔ `CHANGE_REFUSALS.forget`; `WifiCopyState` ↔ `WIFI_COPY_STATES`; `WifiCopyFailure` ↔ `WIFI_COPY_FAILURES`; `WifiNoCopyReason` ↔ `WIFI_NO_COPY_REASONS`;
  - `ProtocolRefusal` ↔ `[...PARSER_REFUSALS without "unknown_request", "host_failed"]`;
  - `NetworkScanRefusal`, `NetworkJoinRefusal`, `NetworkForgetRefusal`, `TagWriteRefusal` ↔ the protocol list plus `REPLY_REFUSALS["network.scan"]` and so on; and `REPLY_REFUSALS["network.read"]`, `["screen.read"]`, `["screen.set"]` each `toEqual([])`, since those three answer only `ProtocolRefusal`.
  - **Every value passes through the client,** with a fake host: `networkRead` with `bootCopy` `{"state":"absent","reason":<each WIFI_NO_COPY_REASONS value>,"failure":null}`, `{"state":"failed","reason":null,"failure":<each failure>}`, and each state; a `change` with each kind and each refused reason for it; `networkScan` with one network of each security; `screenRead` with each start; `tagWrite` with each outcome; each request's every refusal. Build these replies from the literal lists in the test (the "round trip" exception in the execution notes), and assert each answer is `available: true` carrying that value, or `refused` with that word. Exactly these: `bootCopy` absent with each of the 11 reasons, failed with each of the 6 failures, and each of the 4 states (`failed` with `io-failed`, the others with `null`s) = 21; `change` refused with each of the 4 join reasons and the 1 forget reason, `kind: "join"` in each of the 3 states (`refused` with `failed`), and each of the 2 kinds `running` = 10; 3 securities; 2 starts; 3 outcomes; and each method's refusals, the 4 protocol ones plus its own (4 + 6 + 6 + 6 + 4 + 4 + 8) = 38: **77** in all. Assert the loop ran the literal `77` times and the fake host's `connections()` is `77`, so an empty list cannot pass silently.
- [ ] **Step 2: Red, three ways.** Run the focused command on `src/box-host-client.types.test.ts`: it should pass at run time, since Tasks 1–3 built what it checks. Then `pnpm --filter @waitron/server typecheck`: expected `TS7016` for `wifi-record.mjs` and `wifi-boot-copy.mjs` until their declarations exist, and errors for the host-protocol lists until they are declared. Then `pnpm exec vitest run scripts/root-scope-consumers.test.mjs`: expected the exact-list case to fail wanting `scripts/box/wifi-record.mjs` and `scripts/box/wifi-boot-copy.mjs` against `apps/server`.
- [ ] **Step 3: Implement:** the declarations above; `["scripts/box/wifi-record.mjs", ["apps/server"]]` and `["scripts/box/wifi-boot-copy.mjs", ["apps/server"]]` in `ROOT_SCOPE_CONSUMERS`.
- [ ] **Step 4:** Focused command, typecheck, root-scope, `changed-scope` and `changed-packages` tests green; the clock guard; prettier and eslint clean.
- [ ] **Step 5: Controls.** One at a time: add `"setup"` to `StartScreen` in `box-host-client.ts` (typecheck fails with `TS2344` on that pair, finding 12); remove `"owe"` from the test's `WifiNoCopyReason` literal list (both the typecheck and the run-time equality fail); add `"wep"` to the test's `SCAN_SECURITY` literal and to `ScanSecurity` together (only the run-time equality fails, so the module is the one being held).
- [ ] **Step 6: Commit:** `git add apps/server/src/box-host-client.types.test.ts apps/server/src/box-scripts.d.ts scripts/changed-scope.mjs && git commit -s -m "test(server): hold the box host client's types to the protocol's lists"`.

### Task 6: backlog and pointers

> The drafts below are what to write. If review narrows anything, write what landed, not the draft.

**Files:** `docs/backlog/box.md`, `docs/backlog.md`, `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, `docs/developers/conventions-data.md`.

- [ ] **Step 1: "Built so far", PR 8,** in `docs/backlog/box.md` after PR 7's paragraph (which ends before "**A box that already holds Waitron**", line 1040 on main): `boxHostRequests()` in `apps/server/src/box-host-client.ts`, called by nothing yet: the seven requests, typed answers, every failure an `available: false` answer, `unsupported` for `unknown_request` and for `request_invalid` to a line over 700 characters, a complete reply before a broken connection read as the reply, waits of 5 and 20 seconds, the module imported from `scripts/box/` with its types declared in `apps/server/src/box-scripts.d.ts`, and the protocol's lists now exported and held to the server's types.
- [ ] **Step 2: "For later slices, from PR 8's re-map"** in `docs/backlog/box.md`, after PR 7's list (ends before "**Left open by PR 1's review (#2370):**", line 1251 on main):
  - *Routes PR:* builds `boxHostRequests()` in `boot.ts`; mints `PersonActor` from the signed-in person after checking `system.manage`; maps each answer to a route answer and error code (`unsupported` and `missing` are "this box cannot do this", not faults); never logs a `networkJoin` argument; runs `tagWrite` as the server's own duty.
  - *Forwarding PR (Linux):* once the shell lets B3 lines past 700 characters, decide whether D4's rule stays (it also reads a lagging host's `request_invalid` to a long line); measure a forwarded read, scan and change against D6's 5 and 20 seconds; if the Node host runs as its own service, stopping the shell's instance at 15 seconds no longer stops a change, so the 20-second reasoning needs revisiting.
  - *Routes PR, also:* deciding that a venue name the tag cannot hold goes as `null` (PR 7's D12) needs `usableVenueName` from `scripts/box/name-tag.mjs`, unless the route reads this client's `invalid` and sends `null` again; importing it needs a declaration and a `ROOT_SCOPE_CONSUMERS` entry, which would also close D11's gap for `name-tag.mjs`. The socket accepts at most four connections at once (`MaxConnections=4`, `deploy/box/waitron-box.socket:10`): a dashboard re-reading `network.read` while a change runs, beside the clock watch's status reads and sets, must stay inside that, and nobody has measured what a fifth does. If the route reads the socket path from an environment variable, an empty value falls back to the default as an unset one does (`isUnset`, `apps/server/src/env-value.ts:5`); today the path is fixed (`box-host-client.ts:33`). `bundle-smoke` proves nothing about this client until something calls it.
  - *Screen PR:* words for `unsupported`, `missing`, `lost`, `timeout`, `malformed` and each refusal, in English and Spanish.
  - *Open:* the clock client still answers `lost` to a complete reply followed by a broken connection (D5); its lines are under 700 characters, so the shell reads them whole, but a later host could break the connection after answering. `name-tag.mjs`, `upgrades/contracts.mjs` and `disk-key.mjs` select no package in CI when they alone change, though the server's bundle includes them (D11; the root-scope guard's stated gap). `keyMgmt`'s two values are not held to a module list (D9).
  - *Decisions recorded for review:* importing the module with a declaration in the server rather than `allowJs`, a package or a twin (D1); `unsupported` and `invalid` as the client's words (D3); reading a reply before a broken connection for B3 only (D5); the waits (D6).
- [ ] **Step 3: `docs/backlog.md`,** the B3 entry (line 5313 on main): append one sentence after PR 7's: "PR 8 ([plan](superpowers/plans/2026-11-06-b3-8-host-client.md)) adds the server's client for those seven requests in `apps/server/src/box-host-client.ts`, called by nothing yet: typed answers, never a throw, and a box with only the clock handler read as not taking them."
- [ ] **Step 4: Pointers in the parent plan.** At the top, above PR 7's line: `> 2026-11-06: PR 8's plan (the server's client for the host's seven requests, unwired): [2026-11-06-b3-8-host-client.md](2026-11-06-b3-8-host-client.md); it imports PR 7's module and declares its types in the server (its D1).` Under Task 3.1's **Interfaces** paragraph, after PR 7's pointer (line 176 on main): `> 2026-11-06: [PR 8's plan](2026-11-06-b3-8-host-client.md) builds the server client as \`boxHostRequests()\`, one typed method per request instead of \`boxHostCall<T>\`, in \`box-host-client.ts\` beside the clock client (its D2, D3).`
- [ ] **Step 5: `docs/developers/conventions-data.md`,** after the paragraph "**The server's client** (`apps/server/src/box-host-client.ts`)" (line 4317 on main), one sentence: "The same file's `boxHostRequests()` asks B3's seven host requests with the same never-a-throw answers, plus `unsupported` (the host does not take that request) and `invalid` (nothing sent); nothing calls it yet ([B3 PR 8's plan](../superpowers/plans/2026-11-06-b3-8-host-client.md))."
- [ ] **Step 6: Guides and CLAUDE.md.** No guide changes: nothing a person sees changed. No CLAUDE.md line unless an implementing task paid for a new trap; if one did, one line plus a pointer.
- [ ] **Step 7:** `pnpm exec prettier --file-info docs/backlog/box.md` prints `"ignored": true` (docs are not format-checked). Commit: `git add docs/backlog.md docs/backlog/box.md docs/superpowers/plans/2026-10-26-b3-usb-installer.md docs/developers/conventions-data.md && git commit -s -m "docs(backlog): record B3's server client for the host's requests"`.

---

## Self-review

**Parent-plan, PR 7 and box.md coverage.**

| Sentence | Where |
| --- | --- |
| Parent line 174: "`boxHostCall<T>(request:HostRequest):Promise<T>` in new server client wraps the private socket" | D2 (per-request methods); Tasks 2, 3 |
| Parent line 174: "bounded request/response sizes/timeouts" | D6, D7; requests bounded by `formatHostRequest`'s field rules (finding 4); Tasks 2, 3 |
| Parent line 174: "no arbitrary path or command execution" | the client sends only `formatHostRequest`'s line; `invalid` otherwise (Task 2, 3) |
| box.md PR 7 re-map: "sends the exact line `formatHostRequest` writes and checks each reply with `parseHostReply`" | D1; Tasks 2, 3 |
| box.md PR 7 re-map: "chooses between importing the module, moving it into a package, or a TypeScript twin held to it by a shared test" | D1, with finding 6–8 |
| PR 7 D16 / box.md: "must not read `request_invalid` from a shell-only box as a fault"; "`unknown_request` … for that request only" | D3, D4; Tasks 2–4 |
| The task's "every failure answers unavailable, never a throw" | D3; Tasks 2, 3 ("never throws" cases) |

**Names.** New: `boxHostRequests`, `BoxHostRequests`, `HostActor`, `PersonActor`, `ProtocolRefusal`, `HostUnavailable`, `HostAnswer`, `NetworkSnapshot`, `NetworkChange`, `JoinChangeRefusal`, `ForgetChangeRefusal`, `WifiCopyState`, `WifiCopyFailure`, `WifiNoCopyReason`, `ScannedNetwork`, `ScanSecurity`, `WifiJoin`, `NameTag`, `TagOutcome`, `StartScreen`, the four `…Refusal` types, `DEFAULT_HOST_READ_MS`, `DEFAULT_HOST_CHANGE_MS`, the private `sendLine` and `SHELL_LINE_MAX`, the answer words `unsupported` and `invalid`; test helpers `fakeBoxHost`, `answer`, `noBoxHostPath`, `closeFakeBoxHosts`, `shellBoxHost`. Exported from `host-protocol.mjs`: the eight lists of Task 1.

**Task size.** Task 2 is the largest (the reader split, one request, every failure word, the declaration, the helper and one guard entry); each other task touches one code file and one test file plus at most a declaration or a guard entry.

**What the planner ran (2026-11-06):** the probes of finding 6 (tsc four ways, Vitest, ESLint, the bundler, every root guard, the scope selection) with throwaway files, removed after; the Linux and macOS shell-handler probes of finding 9 (`docker run --rm node:26.11.1-slim node /p/run.mjs 3`, and the same script on this Mac); the mode-000 socket probe (finding 10); the line-length measurements (finding 4); the baselines (finding 11); the type-assertion probe (finding 12); the missing-export probe (finding 13). `git status --short` printed nothing after the probes.

**What the planner only read:** the shell handler, the units, the clock client and its test, PR 7's module and plan, `scripts/comments-only.mjs`, `scripts/changed-scope.mjs`'s map, `deploy/Dockerfile`'s build stage and `.dockerignore`, the server's TypeScript and Vitest configs, ESLint's restricted-path zones (none covers `apps/server` importing `scripts/`), and the parent plan and spec at the lines cited.

**Not measured:** a forwarded B3 exchange on a real box, systemd's `Accept=yes` itself (finding 9 stood in for it with a Node server holding the connection, whose close is what broke it; under systemd the handler's own exit would be the last close); how long a scan, a join or a read takes on any box; what `MaxConnections=4` (`deploy/box/waitron-box.socket:10`) does to a fifth concurrent request; a Docker image build with the import in place.

No test of the code above has run, because none of it exists yet.
