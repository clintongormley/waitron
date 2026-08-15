// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/credentials/src/errors.ts and packages/payments/src/errors.ts use.
import "@waitron/shared";
import type { SyncLane } from "./registry.js";

/**
 * packages/sync's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (`sync.*`), never the package name. The rule
 * lives atop packages/shared/src/errors.ts: name what happened to the domain, so `sync.stream_stalled`
 * and never `sync.trigger_failed` (a fact about which plpgsql function threw).
 *
 * NO PARAM HERE CARRIES ROW CONTENT. A sync payload is another tenant's business data; these codes
 * name schema identifiers, environment names and counts only — nothing that reaches a log line or a
 * test name should carry a captured row's bytes.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A subscriber refused a batch because its source ran a different deployment environment than
     * the applier's own. `local` is this node's environment; `peer` is the source's. Checked before
     * any row applies, so a preproduction stream can never seep into a production database or the
     * reverse (design §10, and the one-database-per-environment invariant in CLAUDE.md §5).
     * Environment NAMES only. */
    "sync.peer_environment_mismatch": { local: string; peer: string };
    /** A captured row named a table the enrolment registry does not carry, so there is no apply
     * statement for it. `table` is that table name, taken from `sync_log.table_name` — a schema
     * identifier, never row data. */
    "sync.table_not_enrolled": { table: string };
    /** A subscriber's stream to one origin is stalled. TWO distinct vantage points raise this one
     * code, so the params are a union — each emitter carries exactly the measure it holds, and
     * neither carries row content (schema/identity fields and counts only):
     *   - the TRANSPORT signal (pull.ts): a peer's pull has FAILED often enough that its exponential
     *     backoff SATURATED at `maxBackoffMs`. `backoffMs` is that saturated interval in
     *     milliseconds — a property of the retry schedule, not of any row. `lane` names which
     *     replication lane ('ordered' | 'fast') saturated, since the two run independently and each
     *     backs off on its own — a fixed schema enum, never row content (spec §4d).
     *   - the RETENTION signal (retention.ts `lagFor`, design §9/§12 ops-policy — the alarm/evict
     *     path is not wired here yet): the subscriber has fallen far behind. `lag` is
     *     `origin max(seq) − last_applied_seq`, a count of unapplied rows, never their content.
     * `subscriberId` and `originId` name the lagging (subscriber, origin) pair in both. */
    "sync.stream_stalled":
      | { subscriberId: string; originId: string; backoffMs: number; lane: SyncLane }
      | { subscriberId: string; originId: string; lag: number };
    /** A peer presented a missing, blank or wrong node token to this node's sync-api. NO PARAMS —
     * the response is uniform (fail-closed, no oracle), and a token must never reach a log line or a
     * test name. Mapped to HTTP 401 by `mountSyncApi`'s error boundary. */
    "sync.node_unauthorized": Record<string, never>;
  }
}
