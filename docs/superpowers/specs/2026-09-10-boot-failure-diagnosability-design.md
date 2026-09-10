# Boot-failure diagnosability — design

**Status:** design approved in conversation 2026-09-10 (owner); plan next. Extends the recovery
supervisor of [the node-containers design](2026-09-08-node-containers-design.md) §9 — that document
records what was true when written; this one changes what the recovery page carries.

## 1. The problem, in one paragraph

On 2026-09-10 the first real box (`192.168.10.10`) stopped booting after `try-branch.sh
feat/central-printer-provisioning` was followed by `install.sh` (back to `:main`): three boots in a
row threw, the supervisor escalated, and the recovery page said **`Last error: unknown`** — and so
did `docker logs`. The operator of a real box has **no terminal**; the recovery page is their only
window onto it, and it told them nothing. The developer with SSH had nothing either, because the
entrypoint deliberately drops the caught error (a pg failure's message can embed the connection
string) and logs only `codeOf(error)`, which is `"unknown"` for anything that is not an `AppError`
([`error-code.ts:14-15`](../../../packages/server-kit/src/error-code.ts)). Diagnosis took an hour
of guesswork, one wrong hypothesis that would have wiped the box for the wrong reason, and finally a
wipe — which also destroyed the evidence, so the exact schema artefact that broke the boot was
never confirmed. Both halves are defects: a box that cannot say why it will not start, and a mixed
image/database that nothing detects.

## 2. Decisions (owner, 2026-09-10)

1. **The recovery page is the operator's only window, so it must carry an actionable reason.**
   "Most users will never have access to the terminal on this box; their only window is via the web
   server." `docker logs` is a channel for whoever installed the box, never the fix.
2. **The page is unauthenticated, so it renders only curated text keyed by an error code — never
   the caught error's own words.** Anyone on the venue's LAN can load it. Every message and every
   recovery action on the page is a fixed string chosen by code; the leak guard that motivated the
   current redaction is kept, and made provable (§5).
3. **"Database ahead of this image" is a first-class classified case**, with the operator action
   *restore from a backup, or reinstall*. A real venue's database is not disposable, so the page
   never suggests a wipe; the installer's channel carries the detail.
4. **The scrubbed real error goes to `docker logs`.** For every boot failure, not only the residual
   `unknown`: the error's name, message and stack, with URL-embedded credentials masked. This is the
   installer's channel and the only place raw error text may appear.
5. **`unknown` becomes the rare fallback**, reserved for what the classifier genuinely cannot name.
6. **Flaky or un-diagnosable behaviour is a defect to fix at the root, never routed around.** The
   `try-branch` foot-gun is warned about at the moment it can bite (§4.5), not documented after.

## 3. What is wrong today, grounded

- `runEntry` (`apps/server/src/node-entry.ts:353-399`) wraps the whole attempt — `waitForPostgres`
  → `ensureInstance` (runs the migrations) → `runStagedRestore` → `loadBoxEnv` → `startServer` — in
  one `try`, and on any throw persists `afterFailure(state, codeOf(error))` and rethrows; the
  top-level catch (`:459-463`) logs `server.boot_failed { errorCode: codeOf(error) }` and exits 1.
  `codeOf` is `AppError.code` or `"unknown"`, so a raw pg error, a `TypeError`, a driver error and a
  schema mismatch all become the same word.
- The recovery page (`apps/server/src/recovery-surface.ts:59-81`) renders the bare
  `lastErrorCode`, the failure count, a log tail and the retry button. The tail is the SERVER's
  rotating `waitron.log`; the entrypoint's own log goes to stdout, so a box that failed before
  `startServer` shows `unknown` above an empty tail (`node-entry.ts:320-325` states this, unfixed).
- The entrypoint's stdout logger (`node-entry.ts:427-430`) is `docker logs`, not the page — so the
  channel the installer would use exists, and today carries only the code.
- Drizzle applies only what a set's journal is behind (`instance-plan.ts:136-138`, citing
  `drizzle-orm@0.45.2/pg-core/dialect.js:62`), and journal-table presence is not "applied"
  (`instance-state.ts:41-43`). A database that carries a migration the installed image does not
  have is therefore accepted silently at migrate time and fails later, in whatever query first
  touches the changed schema — as an unclassified pg error. Nothing today can say "your database is
  ahead of this image".
- `deploy/try-branch.sh` builds and runs any branch's image against the box's live database with
  no warning that a migration-carrying branch migrates that database one-way.

## 4. Design

### 4.1 Classify at the boot catch

A pure `classifyBootFailure(error): string` sits between the catch and `afterFailure` /
`server.boot_failed`, so the code the page sees is the best code the entrypoint can name:

- An `AppError` keeps its own code — the existing classification is unchanged.
- A driver failure is classified in two steps, because a refused connection is not a SQLSTATE.
  First, a socket-level error is recognised by its Node `code` — `ECONNREFUSED`, `ENOTFOUND`,
  `ETIMEDOUT`, `EHOSTUNREACH` — and, together with the SQLSTATEs `28P01` (invalid password),
  `3D000` (database does not exist) and `57P03` (cannot connect now), becomes
  `provisioning.database_unreachable { code }`. `sqlStateOf`
  (`packages/shared/src/sql-state.ts:30-41`) returns `null` for those socket codes — they are not
  five `[0-9A-Z]` characters — so the socket branch tests the Node `code` itself; its own doc names
  the one shape-collision to expect (`EPIPE` is five upper-case characters and passes its filter).
  Second, `sqlStateOf`'s result is looked up in a pinned table: `42P01` undefined table, `42703`
  undefined column, `42704` undefined object, `22P02` invalid text for an enum →
  `provisioning.schema_mismatch { sqlState }`. Both tables are exhaustive by construction (pinned
  lists), not heuristics. `waitForPostgres` already retries a refused connection for up to sixty
  seconds (`node-entry.ts`, `WAIT_ATTEMPTS`), so `database_unreachable` names the case that
  outlasted that wait.
- The explicit ahead-of-image check (§4.2) throws `provisioning.database_ahead` before any of those
  can fire, because it runs first.
- Everything else stays `unknown`.

The new codes live in `packages/provisioning/src/errors.ts` — they are facts about the deployment's
database, the family `provisioning.database_unstamped` / `database_not_owned` /
`state_unreadable { sqlState }` already holds; `server.*` stays reserved for facts about the process
(`apps/server/src/errors.ts`). Codes are never renamed once shipped; these are new siblings.

### 4.2 Detect a database ahead of the image, explicitly

After `ensureInstance` and before `startServer`, compare each migration set's **journal hashes**
against the migration files the image ships. A journal entry the image has no file for means the
database was migrated by a newer or different image → throw
`provisioning.database_ahead { set, unknownMigrations }`. Compare hashes, not journal-table
presence (`instance-state.ts:41-43` records why presence proves nothing). The candidate seam is
provisioning's existing journal reads (`instance-state.ts`, `status-command.ts`); the plan picks and
the implementation verifies it against a real container — see §6, this is the experiment that
establishes what an ahead database actually looks like, and it is run, not assumed.

The check runs after `ensureInstance` so a legitimately *behind* database (an upgrade) has already
been migrated forward; only the ahead direction is a failure.

### 4.3 The recovery page renders curated text, keyed by code

`renderPage` gains a table `code → { title, action }` of fixed strings, and renders that beside the
existing level, failure count, log tail and retry button. Examples, wording to be settled in the
plan:

| code | shown to the operator |
| --- | --- |
| `provisioning.database_ahead` | This box's database was set up by a different version of Waitron than the one installed. Restore it from a backup, or reinstall. |
| `provisioning.database_unreachable` | The box's database is not responding. Wait a minute and retry; if it keeps failing, restart the box. |
| `provisioning.schema_mismatch` | The box's database does not match the installed software. Restore it from a backup, or reinstall. |
| `server.config_invalid` / `config_missing` | The box's configuration is invalid. (The existing `variable` is already a fixed name, not user text.) |
| anything else | Waitron could not start. The installer can read the reason on the box. |

Two invariants, both pinned by test (§6): the page never interpolates `error.message`, `stack` or
any caught value — only code-keyed strings and the already-escaped code and tail; and an unknown
code renders the generic line, never a throw (a box that fails before writing a log still has to
serve this page, `recovery-surface.ts:33`).

### 4.4 The installer's channel — `docker logs`, scrubbed

On every boot failure the entrypoint writes, to its stdout sink (`docker logs`; never the
`waitron.log` the page reads), the error's `name: message` and stack through `redactSecrets(text)`,
which masks credentials embedded in URLs (`scheme://user:secret@host` → `scheme://user:***@host`).
This is emitted from `runEntry`'s catch through an injected reporter so it is unit-covered, and
wired to `process.stdout.write` in the real half. The classified `server.boot_failed { errorCode }`
line stays as it is, so the structured stream is unchanged for anything that already reads it.

`redactSecrets` is a pure function with its own suite: it masks a postgres URL's password, leaves
a URL with no credentials alone, leaves an ordinary message alone, and masks every occurrence in a
multi-line stack. It is deliberately narrow — URL credentials are the leak the existing comment
names; it makes no claim to scrub anything else, and the spec says so.

### 4.5 `try-branch.sh` warns where it can bite

Before building, `try-branch.sh` prints — and `deploy/README.md`'s "Trying a branch" section
states — that running a branch whose migrations differ from the box's current image **migrates the
box's database one-way**: a plain `docker compose up -d` back to `:main` will then fail to boot
with `database_ahead`, and the fix is a restore or a reinstall. It does not try to detect whether
the branch carries a migration (it cannot see the branch's files without building it); it warns
every time. A demo box's data is disposable; a real box's is not, and the warning says which.

## 5. The security boundary, as an invariant

The recovery page is reachable by anyone on the venue's LAN with no login. Therefore: **the only
strings the page renders that originate outside the image are the error CODE and the log TAIL, both
already HTML-escaped and both treated as attacker-influenceable (`recovery-surface.ts:21`); the
caught error's text never reaches it.** The raw error text goes to exactly one place, the
entrypoint's stdout, and only after `redactSecrets`. This is proven, not stated: a test injects a
boot failure whose message is a full `postgres://user:hunter2@host/db` string and asserts the
rendered page contains the curated text and NOT `hunter2`, while the same test's control asserts the
installer's stdout DOES carry the message with `hunter2` replaced by `***`. A measurement where both
outcomes look alike measures nothing (CLAUDE.md §1); the control is what makes this one a probe.

## 6. Testing

- **Unit, `classifyBootFailure`:** an `AppError` keeps its code; an error carrying each listed
  SQLSTATE maps to its code, both bare and wrapped one level down in `cause` (the shape Drizzle
  produces, which `sqlStateOf` walks); each listed socket `code` maps to `database_unreachable`; a
  `TypeError` stays `unknown`; both tables are exhaustive — a test walks each pinned list. A
  negative control: a five-upper-case non-SQLSTATE such as `EPIPE` must NOT be classified as a
  database error.
- **Unit, `redactSecrets`:** the four cases in §4.4, with the no-credential and plain-message
  cases as controls.
- **Unit, `renderPage`:** every code in the table renders its curated text; an unknown code renders
  the generic line without throwing; the §5 leak probe with its control.
- **Real Postgres, the ahead-database experiment (the run-it proof):** on a Testcontainers
  instance, provision an instance, record one extra migration in a set's journal (a hash the image
  has no file for) — the shape a branch image leaves behind — then boot the image's code and assert
  `provisioning.database_ahead` with the set and the unknown hash named. Then the negative control:
  the same database with NO extra entry boots. This experiment is what tells the implementation what
  an ahead database actually looks like; the classifier's table in §4.1 is written from it, not
  before it. PGlite is a false pass here (every connection is a superuser and the journal semantics
  under test are drizzle's against real Postgres).
- **Prove the guard by deletion:** with the §4.2 check removed, the same ahead database must fall
  through to a raw pg error classified as `schema_mismatch` or `unknown` — never boot successfully —
  which confirms the check is what names the case rather than something else masking it.
- **The container smoke** (`deploy/`, run by CI's `image / smoke`): unchanged in shape; the plan
  decides whether to add an ahead-database boot to it or leave that to the real-PG suite.

## 7. Out of scope, named

- An authenticated recovery page, or any per-operator detail on it. The boundary in §5 is the
  design; richer detail for the operator is a later, authenticated surface.
- Automatic repair — auto-restore, auto-reinstall, or migrating a database backward. This repo has no
  backward migration by decision (CLAUDE.md §3); the page tells the operator what to do.
- Classifying every conceivable boot failure. Only the families in §4.1; the rest are `unknown`
  with the §4.4 detail, and `unknown` on the page now means "the installer can read it", which is
  true.
- Fixing the empty-tail-before-`startServer` case with a second log sink (`node-entry.ts:320-325`
  states why not); §4.3's curated text is what fills that gap instead.

## 8. Provenance

- The incident: box `Waitron` at `192.168.10.10`, 2026-09-10 18:36–18:55. `try-branch.sh
  feat/central-printer-provisioning` (a branch carrying a `printers` migration), then `install.sh`
  back to `:main` (image `b766090b`). `RestartCount=6`; three `server.boot_failed
  {errorCode:"unknown"}` ~1 s apart per cycle; page `Failed 3 times · Last error: unknown`. Verified
  before wiping: the `printers` table still carried `:main`'s columns (`agent_id`, `usb_path`) — so
  the branch's table migration had NOT landed; the artefact that actually broke the boot (most
  plausibly the non-transactional `bluetooth` enum value, or a journal entry) was **not confirmed**,
  because the box was reset to unblock the owner before the enum was queried. §6's experiment exists
  precisely because that question is still open.
- Owner, 2026-09-10: "be aware that most users will never have access to the terminal on this box,
  there only window is via the web server"; "CI flakes are just bad tests that waste time and must be
  fixed"; approval of the classify-on-the-page + scrubbed-`docker logs` shape, and of *restore or
  reinstall* as the `database_ahead` action.
- Code cited: `apps/server/src/node-entry.ts` (`:320-325`, `:353-399`, `:427-430`, `:459-463`),
  `apps/server/src/recovery-surface.ts` (`:21`, `:33`, `:59-81`),
  `apps/server/src/recovery-state.ts` (`afterFailure`), `packages/server-kit/src/error-code.ts`
  (`codeOf`), `packages/shared/src/sql-state.ts` (`sqlStateOf`),
  `packages/provisioning/src/instance-plan.ts:136-138` and `instance-state.ts:41-43` (journal
  semantics), `packages/provisioning/src/errors.ts` (the `provisioning.*` family).
