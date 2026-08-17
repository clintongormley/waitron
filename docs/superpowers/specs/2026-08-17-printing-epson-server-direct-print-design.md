# Printing — Epson Server Direct Print (the second cloud-poll vendor)

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan alongside. **Track:** a
vendor follow-up to the [cloud_poll transport](2026-08-17-printing-cloud-poll-transport-design.md), which
built the poll-based delivery for **Star CloudPRNT**. **Runs SUPERVISED**. Adds the second cloud-poll
vendor behind the same outbox.

The Star slice built a poll→fetch→ack endpoint served from the central `print_jobs` outbox. **Epson
Server Direct Print** is the same *shape* — the printer's firmware dials out and polls a server URL for
jobs, fetches the print data, and reports status — with a **different vendor wire contract**. This slice
adds an Epson endpoint variant beside the Star one, reusing all the outbox/claim/ack/token machinery.

## 0. Owner decisions this slice is built on (2026-08-17)

- Mechanical — the second cloud-poll vendor, as flagged when Star was chosen first. No product decisions;
  the only genuinely new work is Epson's wire contract.

## 1. Scope

**In:** a printer **`cloud_poll_vendor`** discriminator (`star` | `epson`); an **Epson Server Direct
Print endpoint variant** (poll → fetch → ack, token-authed, serving the same outbox with the same claim /
timeout-requeue as Star); the dashboard cloud_poll config gaining the vendor choice + the right poll URL.

**Out:** any change to the Star path, the outbox/enqueue side (unchanged — transport-agnostic), or the
local transports; a Star-markup/Epson-format renderer **only if** ESC/POS is not accepted by the target
Epson printers (§3c, a build finding).

## 2. Data model

**No new table.** One additive column on Slice A's `printers`:

```text
printers.cloud_poll_vendor  cloud_poll_vendor NULL   -- pgEnum ['star','epson']; set only for transport='cloud_poll'
```

(Non-null iff `transport='cloud_poll'` — a CHECK/validation.) Reuses `poll_id` / `poll_token_hash` /
`print_jobs.claimed_at` from the cloud_poll slice. One small migration (via `db:generate`), no custom RLS
part. Re-run `inmutabilidad`.

## 3. Behaviour — the Epson Server Direct Print endpoint variant (`apps/server/src/print-api.ts`)

The **same mechanism** as Star (claim the oldest queued job atomically, serve its payload, ack → done /
requeue; claim-timeout requeue; per-request token auth via `verifySecret`), on an **Epson-shaped**
endpoint group. Reachable by whichever server the printer polls (cloud or local) — reads the central
outbox.

> **Protocol note (verify against Epson's published Server Direct Print / ePOS-Print spec at build —
> CLAUDE.md §1):** Epson's exact request/response shapes (the HTTP verbs, the XML/`ePOS-Print` job
> envelope, the status-report fields, and how the printer presents its device-id/token) are **Epson's
> contract**, not asserted from memory. This spec fixes the mechanism and the reuse; the plan pins the
> concrete fields against the vendor document before coding, and a test drives the real shape once
> confirmed.

### 3a. Poll / fetch / ack (Epson-shaped, same outbox verbs)

An `/print-api/epson-sdp/:pollId` group (Epson's own verbs/paths per the pinned spec): **poll** →
`requirePollToken` + atomically claim the oldest `queued` job → respond job-ready / no-job in Epson's
format; **fetch** → return the job `payload` in Epson's accepted media type (§3c); **ack** → `done`
(`delivered_at`) or `failed` (requeue), with the same **claim-timeout requeue** for an un-acked job. The
`cloud_poll_vendor='epson'` printers route here; `='star'` route to the existing Star group.

### 3b. Reuse (not reimplement)

The claim (`UPDATE … RETURNING`), the requeue, the token guard (`requirePollToken`), the outbox, and the
dashboard enrolment are the **cloud_poll slice's** — this slice only adds the Epson *wire adapter* and the
vendor discriminator. A shared internal `claimNextJob(printerId)` / `ackJob(jobId, status)` (extracted
from the Star slice if not already) backs both vendors.

### 3c. Payload media type (build finding, flagged)

As with Star (§3d there): the outbox `payload` is ESC/POS. Whether Epson Server Direct Print printers take
raw ESC/POS or need an **ePOS-Print XML / raster** rendering is an **Epson vendor/model** question the plan
resolves against Epson's spec + the target printer. If ESC/POS is accepted → serve verbatim; else add a
small Epson renderer in `@waitron/printing` behind the same `payload`. A plan branch, not an assumption.

## 4. Fiscal safety (H2)

**None** — a second transport for the existing outbox; enqueue unchanged and never blocked. Grep receipt.

## 5. Client — dashboard

The **Impresoras** cloud_poll printer form (Star slice) gains a **vendor** choice (`star` / `epson`); on
`epson`, it generates the `poll_id` + token (shown once) and displays the **Epson** poll URL
(`https://<server>/print-api/epson-sdp/<pollId>`) for the installer. `printer.manage`; a11y both themes.

## 6. Conventions

- **English identifiers** — `cloud_poll_vendor`. No new `SPANISH_WORDS`.
- **Domain error codes** — reuse `printer.not_found` / `printer.poll_unauthorized` (cloud_poll slice). No
  new code. `import "./errors.js"`.
- **Reuse crypto + machinery** — `verifySecret`/`timingSafeEqual`; the shared `claimNextJob`/`ackJob`.
- **Permission** — `printer.manage` (config); the poll endpoints are token-authed.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **PGlite / real-PG** — an `epson` cloud_poll printer's poll claims the oldest queued job (double-poll
  race → one claim, proven by deletion of the lock — shared with Star); fetch serves the payload for the
  right printer only; ack → done; failed → requeue; claim-timeout requeue; a wrong token → 401.
- **Protocol** — once the Epson fields are pinned (plan Step), a test drives the real poll/fetch/ack
  request/response shapes; the media type is asserted (§3c branch).
- **Dashboard** — selecting `epson` generates the token + shows the Epson poll URL; a11y both themes.
- **Fiscal** — the H2 grep (transport only).
- **Regression** — the Star path is unchanged (its tests stay green — CLAUDE.md "preserve behavioural
  assertions"; the shared `claimNextJob`/`ackJob` must not alter Star's behaviour).
- Coverage **98/98/98/95** (db, server, `@waitron/printing`), **95/95/90/88** (dashboard). Run
  `packages/db` unfiltered; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies

- **Builds on the cloud_poll (Star) slice** (`poll_*`, `claimed_at`, the shared claim/ack/requeue, the
  dashboard cloud_poll form) → build after it. Re-verify those symbols first (CLAUDE.md §1). The enqueue
  side (KDS-4, the receipt consumer) is untouched — an Epson cloud printer prints with no change once this
  lands. **Completes cloud-poll vendor coverage** (Star + Epson).

## 9. Provenance

Designed against the cloud_poll (Star) design on 2026-08-17. In-tree reuse (cited to that slice): the
`poll_id`/`poll_token_hash` columns, `print_jobs.claimed_at`, `requirePollToken`, the claim/serve/ack +
timeout-requeue, the `print-api.ts` mount, and the dashboard cloud_poll form. The **Epson Server Direct
Print protocol** is an **external vendor contract**, described here only at the mechanism level and
**flagged for verification against Epson's published spec at build** (CLAUDE.md §1); the ESC/POS-vs-ePOS
media question (§3c) is likewise a build finding.
