// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one — the idiom packages/purchasing, packages/layouts, packages/sync use.
import "@waitron/shared";

/**
 * packages/printing's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention, never the package name. The concepts here are
 * printers, agents and print jobs: `printer.*`, `agent.*` and `print_job.*`. Each throwing module
 * imports this registry so the augmentation is reachable from the package barrel.
 * Agent enrolment is join-and-accept (the shared join_requests mechanism, whose codes live in
 * apps/server) — this package owns no enrolment codes.
 *
 * The agent-auth code carries NO params: an agent-auth failure must not become an oracle (which agent
 * ids exist), mirroring identity's `pin.invalid`/`passkey.verification_failed` and sync's
 * `sync.node_unauthorized`. Codes are never renamed once shipped: a wrong one is deprecated and a new
 * one added beside it.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No print job with this id is visible in the current tenant. */
    "print_job.not_found": { id: string };
    /** The job is still eligible for automatic delivery. */
    "print_job.not_resendable": { id: string };
    /** No printer with this id is visible in the current tenant. `id` is the id looked up. */
    "printer.not_found": { id: string };
    /** A supplied printer config was rejected by `createPrinter` (printers.ts) before any write: a
     * transport whose REQUIRED connection fields are absent — `host` for `network_tcp`, `local_key`
     * for `usb`/`bluetooth`, `poll_id` for `cloud_poll`; no transport requires `agent_id`. This mirrors
     * the DB `printers_transport_fields_ck` CHECK, which stays the integrity backstop; the app-layer
     * check only turns a missing field into this friendly code rather than a raw 23514. `reason` is a
     * stable English discriminator (e.g. `network_tcp_missing_host`), never a user-facing sentence. */
    "printer.invalid_config": { reason: string };
    /** A create/register whose stable device key (USB serial / Bluetooth MAC) already names a printer
     * in this venue — the partial UNIQUE (tenant_id, location_id, local_key). `localKey` is echoed so
     * the dashboard can point at the existing registration. */
    "printer.already_registered": { localKey: string };
    /** No print agent with this id is visible in the current tenant. `id` is the id looked up. */
    "agent.not_found": { id: string };
    /** The agent's bearer token did not verify, or the agent has been revoked — `requireAgent`
     * fail-closed. NO params: a uniform, oracle-free 401 that never discloses which agent ids exist. */
    "agent.unauthorized": Record<string, never>;
  }
}
