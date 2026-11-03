/**
 * A box's own state — its `node.db` tables, the `local` tables inside `venue.db`, files in its state
 * folder, and Litestream's folder beside `venue.db` — and what the receiving box (M2) does with each
 * after a handover. One row per exact table or file name. The root guard
 * `scripts/handover-manifest-complete.test.ts` fails when a `node.db` or `local` table, a recovery
 * file, an optional backup file or a file behind a module's backup source has no row; other
 * state-folder files are not checked.
 */
export interface NodeLocalManifestRow {
  readonly item: string;
  readonly where: "node.db" | "venue.db" | "state" | "venue-folder";
  readonly class: "transferred" | "source-only" | "destination-owned" | "rebuildable";
  readonly treatment: string;
}

/** A manifest row as the final-state indicator reports it, with what the source box holds. */
export interface NodeLocalItem extends NodeLocalManifestRow {
  readonly sha256?: string | null;
  readonly ringVersions?: number[];
}

const KEEPS_OWN = "M2 keeps its own; M1's never travel";
const OWN_HANDOVER = "each box keeps its own";
const TLS = "M2 keeps its own; the venue authority reached it at joining";

export const NODE_LOCAL_MANIFEST: readonly NodeLocalManifestRow[] = [
  { item: "node_mode", where: "node.db", class: "destination-owned", treatment: KEEPS_OWN },
  { item: "node_mirror_link", where: "node.db", class: "destination-owned", treatment: KEEPS_OWN },
  { item: "node_primary_key", where: "node.db", class: "destination-owned", treatment: KEEPS_OWN },
  {
    item: "node_recovery_key",
    where: "node.db",
    class: "destination-owned",
    treatment: "M2 keeps its own recovery-key check",
  },
  {
    item: "node_signing_key",
    where: "node.db",
    class: "source-only",
    treatment: "M1's private key never leaves M1",
  },
  {
    item: "node_handover_operations",
    where: "node.db",
    class: "destination-owned",
    treatment: OWN_HANDOVER,
  },
  {
    item: "node_handover_events",
    where: "node.db",
    class: "destination-owned",
    treatment: OWN_HANDOVER,
  },
  {
    item: "node_handover_restriction",
    where: "node.db",
    class: "destination-owned",
    treatment: OWN_HANDOVER,
  },
  {
    item: "join_requests",
    where: "venue.db",
    class: "source-only",
    treatment:
      "inside the copy; keyed by the receiving box's node id; M2 reads only its own rows, so M1's lie unused",
  },
  {
    item: "change_log",
    where: "venue.db",
    class: "rebuildable",
    treatment:
      "inside the copy; a dashboard signal deleted by the transaction that wrote it; a leftover row is delivered once on M2, harmlessly",
  },
  {
    item: "node_sealed_state",
    where: "venue.db",
    class: "source-only",
    treatment:
      "inside the copy; M1's state files sealed with M1's recovery key, which M2 cannot open; M2 writes its own row",
  },
  {
    item: "recovery_packs",
    where: "venue.db",
    class: "source-only",
    treatment: "inside the copy; keyed by M1's node id; M2 reads its own or none",
  },
  {
    item: "fiscal_certificate_installs",
    where: "venue.db",
    class: "source-only",
    treatment:
      "inside the copy; keyed by M1's node id; the certificate itself is in tenant_credentials",
  },
  {
    item: "fiscal_certificate_reminders",
    where: "venue.db",
    class: "source-only",
    treatment:
      "inside the copy; keyed by M1's node id; the certificate itself is in tenant_credentials",
  },
  {
    item: "tenant_credentials",
    where: "venue.db",
    class: "transferred",
    treatment:
      "inside the copy; sealed under the venue key ring, so usable on M2 only when M2's ring holds every version",
  },
  {
    item: "secrets.env",
    where: "state",
    class: "transferred",
    treatment:
      "earlier: the key ring reached M2 at joining; the indicator lists the ring's key versions and M2 refuses handover.key_ring_mismatch when it lacks one",
  },
  {
    item: "trading.env",
    where: "state",
    class: "destination-owned",
    treatment: "M2 keeps its own node id; promotion rewrites it",
  },
  { item: "tls/ca.crt", where: "state", class: "destination-owned", treatment: TLS },
  { item: "tls/ca.key", where: "state", class: "destination-owned", treatment: TLS },
  { item: "tls/server.crt", where: "state", class: "destination-owned", treatment: TLS },
  { item: "tls/server.key", where: "state", class: "destination-owned", treatment: TLS },
  { item: "tls/venue-ca.crt", where: "state", class: "destination-owned", treatment: TLS },
  { item: "tls/venue-ca.key", where: "state", class: "destination-owned", treatment: TLS },
  {
    item: "backup.env",
    where: "state",
    class: "transferred",
    treatment:
      "compared: the indicator carries its digest; a difference waits handover.backup_settings_differ",
  },
  {
    item: "modules.json",
    where: "state",
    class: "transferred",
    treatment: "compared, as backup.env; M2 refuses a module set that differs",
  },
  {
    item: "module-preparation-state.json",
    where: "state",
    class: "transferred",
    treatment:
      "M1's retained minute selections are not in the copy, and placed as module-evidence the restore way they do not reach promotion, so the spare reuses an abandoned selection's name when its checked clock reads that minute; Task 5.7 merges M1's retained selections into M2's own file before activation (owner question open)",
  },
  {
    item: "module-evidence/<module>/<source>.json",
    where: "state",
    class: "source-only",
    treatment:
      "the retained public history a restore placed, read beside module-preparation-state.json by the module's backup source; M2 keeps its own",
  },
  {
    item: ".venue.db-litestream/",
    where: "venue-folder",
    class: "rebuildable",
    treatment:
      "beside venue.db in the venue folder; never copied; the new primary opens a new generation",
  },
];
