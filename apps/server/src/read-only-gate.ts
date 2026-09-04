import type { MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import "./errors.js"; // makes `node.read_only` reachable (the code is constructed below)

/** This gate blocks every HTTP verb EXCEPT the safe reads GET/HEAD/OPTIONS — i.e. every write verb the
 * dashboard (management/catalogue/report/recipe/schedule/purchasing/workforce/me) uses; a survey of that
 * DASHBOARD read surface found no read behind a non-safe verb (C2a design §5). HEAD is a bodyless GET and
 * OPTIONS is a CORS preflight — neither mutates, so both pass.
 *
 * IMPORTANT — this is NOT "no write behind any GET". It gates by HTTP VERB, so an INTERNAL SQL write
 * inside a GET handler still runs — e.g. the management-session keepalive (`mirror-session.ts`) does
 * `update management_sessions set last_seen_at = now()` on a mirror's own GETs. That is intended: the gate
 * refuses a CLIENT'S write verb, not the server's own bookkeeping (`mirror-session.ts:49` spells this out).
 *
 * The operational agent/device groups are no longer mounted under `mode='mirror'`: boot.ts wraps both
 * `mountDeviceApi`/`mountPrintApi` in its `if (!fencedOrMirror)` mount guard (boot.ts, where
 * `fencedOrMirror = isMirror || fenced`). That closes the one actual
 * write-behind-a-GET on this surface — `GET /print-api/agent/jobs`, whose `claimPrintJobs` runs a locking
 * `SELECT … FOR UPDATE … SKIP LOCKED` + `UPDATE` (packages/printing/src/runtime.ts:145-179) that the verb
 * gate cannot catch. (The device group's own writes are all non-safe verbs the gate already refuses; it is
 * dropped from a mirror as part of the same operational surface, not because it hid a write behind a GET.)
 * So on a mirror that print write-GET is UNREACHABLE (404 — no route), not merely inert because its backing
 * tables (`print_*`) are unprovisioned. A FENCED node (membership rejoin R1) is `mode='primary'`, so this
 * verb gate alone would let that write-GET through; the `fenced` case of that same mount guard un-mounts the
 * operational device/print groups on a fenced node too, so the write-behind-a-GET stays closed (404) for a
 * fenced node exactly as it is for a mirror. This gate is unchanged; only the surface behind it shrank. A future
 * slice that RE-MOUNTS those groups on a mirror (kitchen-sync, promotion) revives the write-behind-a-GET
 * concern — keep them gated by `if (!fencedOrMirror)` (NOT the narrower `!isMirror`, which would re-expose
 * the write-GET on a fenced node), or allow-list the write-GETs here. The dashboard read surface a mirror
 * or fenced node serves stays fully covered.
 *
 * ALTITUDE (deliberate, deferred to promotion Slice 3): the landed promotion design
 * (docs/superpowers/specs/2026-08-29-promotion-runbook-design.md §3a "Mount-and-gate everything") sets the
 * eventual direction — mount the whole surface in BOTH modes and gate at REQUEST time, so a live
 * mirror→primary promotion re-mounts nothing and needs no restart. Boot-time un-mounting is chosen HERE
 * because (a) it is the tighter read-only-mirror posture — no operational agent/device surface is exposed
 * at all — and (b) the verb-based request gate cannot catch a write-behind-a-GET without adding a new
 * path-level deny-list. Converting this to the §3a request-time form belongs with Slice 3, which already
 * has to convert the analogous boot-`const isSingletonPrimary` worker gates (sync source / retention /
 * backup / tunnel, §3c — re-gated onto `singleton_role` in #168) to runtime-startable — so this gate
 * rides with that work rather than adding standalone debt. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses every write verb when `isReadOnly()` is true. Read PER REQUEST (not captured once) so a
 * live mirror→primary promotion — `deployment.mode = 'primary'` + a refresh of the holder boot passes
 * in — opens every write route without a restart (design §10). Boot builds the predicate; today it is
 * `() => holders.mode.current === "mirror" || fenced` — a read-only MIRROR, or a FENCED returned
 * ex-primary that adopted a superseding sell-only/evicted document (membership rejoin R1, design §6).
 * On an unfenced primary it is a pure pass-through.
 *
 * Returns the error-boundary response shape directly (`{ error: { code, params } }`) rather than
 * throwing: a Hono middleware is not inside a route's `createErrorBoundary` wrapper; the code is built
 * through `AppError` so `tsc` checks it and `import "./errors.js"` keeps it reachable.
 */
export function readOnlyGate(isReadOnly: () => boolean): MiddlewareHandler {
  return async (c, next) => {
    if (isReadOnly() && !SAFE_METHODS.has(c.req.method)) {
      const err = new AppError("node.read_only", {});
      return c.json({ error: { code: err.code, params: err.params } }, 403);
    }
    return next();
  };
}
