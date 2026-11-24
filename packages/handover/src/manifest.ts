import type { CanonicalValue } from "@waitron/membership";
import { isSha256Hex } from "./envelope.js";
import type { OperationBinding } from "@waitron/module";

/**
 * Handover decisions for the box's tables and declared state entries.
 * Declaration checks and their limits: scripts/handover-manifest-complete.test.ts.
 */
export interface NodeLocalManifestRow {
  readonly item: string;
  readonly where: "node.db" | "venue.db" | "state" | "venue-folder";
  readonly class: "transferred" | "source-only" | "destination-owned" | "rebuildable";
  readonly treatment: string;
}

export interface RetainedRevision {
  readonly binding: OperationBinding;
  readonly value: CanonicalValue;
}

/** A manifest row as the final-state indicator reports it, with what the source box holds. */
export interface NodeLocalItem extends NodeLocalManifestRow {
  readonly sha256?: string | null;
  readonly ringKeys?: readonly RingKeyFingerprint[];
  readonly revisions?: readonly RetainedRevision[];
}

export interface RingKeyFingerprint {
  readonly version: number;
  readonly sha256: string;
}

export function isRingKeys(raw: unknown): raw is readonly RingKeyFingerprint[] {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  const seen = new Set<number>();
  return raw.every((entry: unknown) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
    const key = entry as Record<string, unknown>;
    if (
      Object.keys(key).sort().join() !== "sha256,version" ||
      !Number.isSafeInteger(key.version) ||
      (key.version as number) < 1 ||
      !isSha256Hex(key.sha256) ||
      seen.has(key.version as number)
    )
      return false;
    seen.add(key.version as number);
    return true;
  });
}

export const MODULE_PREPARED_ITEM = "module-records/<module>.json#prepared";

const KEEPS_OWN = "M2 keeps its own; M1's never travel";
const OWN_HANDOVER = "each box keeps its own";
const TLS = "M2 keeps its own; the venue authority reached it at joining";

export const NODE_LOCAL_MANIFEST: readonly NodeLocalManifestRow[] = [
  { item: "node_pair_link", where: "node.db", class: "destination-owned", treatment: KEEPS_OWN },
  {
    item: "node_take_failures",
    where: "node.db",
    class: "destination-owned",
    treatment: KEEPS_OWN,
  },
  {
    item: "box",
    where: "node.db",
    class: "destination-owned",
    treatment: "M2 keeps its own role, recovery key, mirror link and pinned key",
  },
  {
    item: "box.signing_key",
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
      "inside the copy; a dashboard signal deleted by the transaction that wrote it; a leftover row is delivered once on M2",
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
    item: "document_delivery_requests",
    where: "venue.db",
    class: "source-only",
    treatment:
      "inside the copy; retains the originating node and recovery epoch; routing must not adopt these rows under another origin",
  },
  {
    item: "document_delivery_sequences",
    where: "venue.db",
    class: "source-only",
    treatment:
      "inside the copy; retains the originating node and recovery epoch; routing must not adopt these rows under another origin",
  },
  {
    item: "device_invoice_save_operations",
    where: "venue.db",
    class: "source-only",
    treatment:
      "inside the copy; retains the originating node and recovery epoch; routing must not adopt these rows under another origin",
  },
  {
    item: "verifactu_certificates",
    where: "venue.db",
    class: "transferred",
    treatment:
      "inside the copy; keyed by M1's node id, and M2 reads them through its takeover history; the certificate itself is in venue_credentials",
  },
  {
    item: "fiscal_certificate_reminders",
    where: "venue.db",
    class: "transferred",
    treatment:
      "inside the copy; keyed by M1's node id, and M2 reads them through its takeover history; the certificate itself is in venue_credentials",
  },
  {
    item: "venue_credentials",
    where: "venue.db",
    class: "transferred",
    treatment:
      "inside the copy; sealed under the venue key ring, so usable on M2 only when M2's ring holds every matching key",
  },
  {
    item: "secrets.env",
    where: "state",
    class: "transferred",
    treatment:
      "earlier: the key ring reached M2 at joining; the indicator lists each key's version and fingerprint",
  },
  {
    item: "trading.env",
    where: "state",
    class: "destination-owned",
    treatment: "M2 keeps its own node id, written when it joined",
  },
  { item: "tls/ca.crt", where: "state", class: "destination-owned", treatment: TLS },
  { item: "tls/ca.key", where: "state", class: "destination-owned", treatment: TLS },
  { item: "tls/server.pem", where: "state", class: "destination-owned", treatment: TLS },
  {
    item: "backup.env",
    where: "state",
    class: "transferred",
    treatment: "compared: the indicator carries a digest of its values",
  },
  {
    item: "settings:modules",
    where: "venue.db",
    class: "transferred",
    treatment: "compared: the indicator carries a digest of the modules it switches off",
  },
  {
    item: MODULE_PREPARED_ITEM,
    where: "state",
    class: "transferred",
    treatment:
      "the indicator carries M1's retained selections, which are not in the copy; M2 merges them into its own file before the copy is placed, because a minute name M1 selected and never activated still counts as used",
  },
  {
    item: "module-records/<module>.json#retained",
    where: "state",
    class: "source-only",
    treatment:
      "the retained public history a restore placed, read from its module record by the module's backup source; M2 keeps its own",
  },
  {
    item: "fiscal-readiness-db-*",
    where: "state",
    class: "source-only",
    treatment:
      "Not carried: isolated preproduction chains belong to the box that ran the readiness test",
  },
  {
    item: "flows/",
    where: "state",
    class: "destination-owned",
    treatment:
      "Not carried: each box retains its own setup, restore and TLS-repair operation records and attachments",
  },
  {
    item: "environment-recovery-move.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains its own interrupted environment-recovery move",
  },
  {
    item: "spare-space",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box reserves its own filesystem space",
  },
  {
    item: "spare-space.released",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains its own full-disk sale stop",
  },
  {
    item: "backup-room-note.json",
    where: "state",
    class: "source-only",
    treatment:
      "Not carried: the note describes M1's backup ownership; copy placement deletes M2's note",
  },
  {
    item: "backup-room-start-deleted.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains the record of its own start cleanup",
  },
  {
    item: "reset-request.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains its own request for its next start",
  },
  {
    item: "replaced-reset.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: a replaced main box's own reset, finished at its next start",
  },
  {
    item: "pending-adoption.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains its own unfinished adoption",
  },
  {
    item: "recovery.lock",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: recovery is serialised separately on each box",
  },
  {
    item: "scratch/",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: temporary working copies belong to each box",
  },
  {
    item: "setup-clock-step.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: the pending notice describes this box's own clock step",
  },
  {
    item: "identity-change.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: an upgrade's note is for the box that was upgraded",
  },
  {
    item: "checked-addresses.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains addresses it has reached",
  },
  {
    item: "recovery.json",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: recovery progress belongs to each box",
  },
  {
    item: "module-records/",
    where: "state",
    class: "source-only",
    treatment:
      "Not carried as a folder: the indicator carries M1's prepared selections; M2 keeps its own retained history",
  },
  {
    item: "stream/",
    where: "state",
    class: "rebuildable",
    treatment: "Not carried: the new primary starts its own bucket stream",
  },
  {
    item: "handover/",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains its own handover operation files and copies",
  },
  {
    item: "pair-store/",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each spare holds its own received stream",
  },
  {
    item: "pair-copy/",
    where: "state",
    class: "destination-owned",
    treatment: "Not carried: each box retains its own staged incoming copy",
  },
  {
    item: "tls/",
    where: "state",
    class: "destination-owned",
    treatment:
      "Not carried: each box retains its own TLS keys, certificates and installation state",
  },
  {
    item: "venue/",
    where: "state",
    class: "destination-owned",
    treatment:
      "Not carried as a folder: the handover places venue.db separately; M2 keeps its own node.db",
  },
  {
    item: "records/",
    where: "state",
    class: "source-only",
    treatment:
      "Not carried: start-again choices and set-aside files remain on the box that made them",
  },
  {
    item: "cloud/",
    where: "state",
    class: "destination-owned",
    treatment:
      "Not carried: each box retains its own Cloud connection, recovery, replacement, staff authority and snapshots",
  },
  {
    item: "logs/",
    where: "state",
    class: "source-only",
    treatment: "Not carried: each box retains its own logs",
  },
  {
    item: "trading.env.replaced",
    where: "state",
    class: "source-only",
    treatment: "Not carried: settings set aside during M1's restore are not M2's trading identity",
  },
  {
    item: ".venue.db-litestream/",
    where: "venue-folder",
    class: "rebuildable",
    treatment:
      "beside venue.db in the venue folder; never copied; the new primary opens a new generation",
  },
];
