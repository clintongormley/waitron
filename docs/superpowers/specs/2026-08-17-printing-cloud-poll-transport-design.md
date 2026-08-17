# Printing — the `cloud_poll` transport (Star CloudPRNT)

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan alongside. **Track:** the
fast-follow transport for the [printing subsystem](2026-08-17-printing-subsystem-design.md) (Slice A).
**Runs SUPERVISED**. Adds the third transport the abstraction was built to carry.

Slice A built `usb` + `network_tcp` — both **pushed** by a local print agent. A `cloud_poll` printer
inverts it: the printer's firmware **dials out and polls** a URL for jobs, so it needs no agent and works
through NAT, and — crucially — it can be served by the **cloud** node (the "route from cloud" case). Slice
A already carries the `cloud_poll` enum value and the `printers.poll_id` / `poll_token_hash` columns; this
slice implements the **poll endpoint** speaking **Star CloudPRNT** (the vendor protocol the distribution
design referenced as the robustness upgrade).

## 0. Owner decisions this slice is built on (2026-08-17)

- **Star CloudPRNT first.** Implement Star's CloudPRNT poll protocol; **Epson Server Direct Print** is a
  later follow-up, the endpoint abstraction built to carry it.

## 1. Scope

**In:** the CloudPRNT **poll endpoint group** (poll → fetch → ack) served from Slice A's `print_jobs`
outbox; per-printer **token auth** (verified against `poll_token_hash`); a `cloud_poll` printer's config +
enrolment (generate `poll_id` + token, show the poll URL) in the dashboard; **claim-and-timeout** so an
un-acked job requeues.

**Out:** Epson Server Direct Print (follow-up); any change to `usb`/`network_tcp` (Slice A) or to the
enqueue side (unchanged — Slice B / the receipt consumer enqueue exactly as before, transport-agnostic);
a Star-markup renderer **only if** ESC/POS is not accepted by the target printers (§3d, a build finding).

## 2. Data model

**No new table.** Slice A's `printers` already carries `transport='cloud_poll'`, `poll_id` (the printer's
poll identifier, in the URL), and `poll_token_hash` (scrypt of the printer's token). One additive column
on `print_jobs` for the claim/timeout:

```text
print_jobs.claimed_at  timestamptz NULL   -- set when a poll hands the job out; NULL again on requeue
```

(Reuses Slice A's `status` `printing` — `claimed_at` timestamps the claim so a stuck `printing` job
requeues after a TTL.) Additive on the FORCE-RLS `print_jobs`; one small migration (via `db:generate`),
no custom RLS part. Re-run `inmutabilidad`.

## 3. Behaviour — the CloudPRNT endpoint group (`apps/server/src/print-api.ts`)

Unauthenticated at the route level (the printer has no session); **authenticated per-request by the
printer's token** (`requirePollToken`, the `verifySecret`/`timingSafeEqual` shape, §7). Mounted so it is
reachable by whichever server the printer is pointed at (the **cloud** node in a mirror topology, or the
local node) — the endpoint reads the **central outbox**, so either serves it.

> **Protocol note (verify against Star's published CloudPRNT spec at build — CLAUDE.md §1):** the exact
> request/response shapes (JSON field names, media-type strings, the poll/get/delete verbs and query
> params) are **Star's contract**, not asserted from memory here. This spec fixes the **mechanism**; the
> plan pins the concrete fields against the vendor document before coding, and a test drives the real
> shape once confirmed.

### 3a. Poll (printer → "any jobs?")

`POST /print-api/cloudprnt/:pollId` (the printer's periodic poll, carrying its status/capabilities). The
server: `requirePollToken`; resolve the `cloud_poll` printer by `poll_id`; **atomically claim** the oldest
`queued` job (`UPDATE … SET status='printing', claimed_at=now() … RETURNING`, the locking claim so a
double-poll doesn't double-serve); respond **job-ready** (with a job token = the job id) when one exists,
else **no-job**. Include the media type the payload is in (§3d).

### 3b. Fetch (printer → "give me the job")

`GET /print-api/cloudprnt/:pollId?token=<jobId>` → `requirePollToken` + the job belongs to this printer →
return the job's **`payload` bytes** with the media type. (The payload is Slice A/consumer ESC/POS — §3d.)

### 3c. Ack (printer → "printed / failed")

`DELETE /print-api/cloudprnt/:pollId?token=<jobId>` (+ a status the printer reports) → mark `done`
(`delivered_at`) or `failed` (`last_error`, `attempts++`, back to `queued` for retry). **Timeout requeue:**
a `printing` job whose `claimed_at` is older than a TTL is returned to `queued` by the next poll (a printer
that pulled but never acked — power-cut mid-print) so it is not lost.

### 3d. Payload media type (build finding, flagged)

Our outbox `payload` is **ESC/POS** (Slice A's builder). Star cloud printers accept several media types;
whether they take raw ESC/POS, or need **Star markup** / a raster, is a **vendor/model** question the
plan resolves against Star's spec + the target printer. If ESC/POS is accepted → serve it verbatim (no
change). If not → add a small **Star-markup/raster renderer** in `@waitron/printing` behind the same
`payload` (the enqueue side stays transport-agnostic). Scoped as a plan branch, not assumed.

## 4. Topology

A `cloud_poll` printer is configured (by the installer) with the **poll URL** (pointing at the cloud or
local server) + its **token**; it dials out on a timer. Because the endpoint reads the **central outbox**,
a job **enqueued on any node** is delivered when the printer next polls — the cleanest "route from local
**or** cloud" case (no agent, no inbound reachability). Single-node works today; multi-node lands with
replication (Slice A §4).

## 5. Fiscal safety (H2)

**None** — a transport for the existing outbox; the enqueue side (fires, receipts) is unchanged and never
blocked. Nothing touches the fiscal path. Grep receipt in the plan.

## 6. Client — dashboard

The **Impresoras** screen's printer form (Slice A) gains the `cloud_poll` transport: on selecting it, the
dashboard **generates a `poll_id` + token** (token shown once, hash stored), and **displays the poll URL**
(`https://<server>/print-api/cloudprnt/<pollId>`) for the installer to enter into the printer's firmware.
Revoke = deactivate the printer (its polls stop being served). `printer.manage`; `@waitron/ui`; a11y both
themes.

## 7. Conventions

- **English identifiers** — `claimed_at`, `poll_id`, `poll_token_hash` (Slice A). No new `SPANISH_WORDS`.
- **Domain error codes** — `printer.not_found` (reuse); `printer.poll_unauthorized` (401, bad token).
  `import "./errors.js"`. Never renamed.
- **Reuse crypto** — `verifySecret`/`timingSafeEqual` for the poll token; no new crypto.
- **Permission** — `printer.manage` (config); the poll endpoints are token-authed, not permission-gated.
- No backwards-compat / data-migration code (pre-production).

## 8. Testing

- **PGlite / unit** — the poll **claims** the oldest queued job atomically (real-PG **double-poll race**
  → one claim, proven by deletion of the lock); fetch returns the payload for the right printer only
  (cross-printer token → `printer.poll_unauthorized`); ack marks `done`; a failed ack requeues; the
  **claim-timeout requeue** returns a stale `printing` job to `queued`.
- **Protocol** — once the Star fields are pinned (plan Step), a test drives the real poll/get/delete
  request/response shapes; the media type is asserted (§3d branch).
- **Security** — a wrong/absent token is 401 (`verifySecret`, constant-time); a deactivated printer's polls
  return no-job.
- **Dashboard** — selecting `cloud_poll` generates the token (shown once) + shows the poll URL; a11y both
  themes.
- **Fiscal** — the H2 grep (transport only; enqueue unchanged).
- Coverage **98/98/98/95** (db, server, `@waitron/printing`), **95/95/90/88** (dashboard). Run
  `packages/db` unfiltered; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 9. Sequencing / dependencies

- **Builds on the printing subsystem (Slice A)** (`printers` + `poll_*`, the outbox, `print_jobs`,
  `verifySecret`) — build after it. The enqueue side is untouched, so **KDS-4 + the receipt consumer print
  to a `cloud_poll` printer with no change** once this lands.
- **Epson Server Direct Print** is the next transport follow-up (a second vendor endpoint behind the same
  outbox).

## 10. Provenance

Designed against the printing-subsystem design on 2026-08-17. In-tree reuse (cited to Slice A): the
`cloud_poll` enum + `printers.poll_id`/`poll_token_hash` (`printing-subsystem-design.md §2b`), the
`print_jobs` outbox (`§2c`), `verifySecret`/`timingSafeEqual` (`secret-hash.ts`, `sync-api.ts:80-88`), the
`print-api.ts` mount. The **Star CloudPRNT protocol** is an **external vendor contract**, deliberately
described here only at the mechanism level and **flagged for verification against Star's published spec at
build** (CLAUDE.md §1 — external claims need the source's own words; the exact fields are not asserted from
memory). The ESC/POS-vs-Star-markup media question (§3d) is likewise a build finding, not an assumption.
