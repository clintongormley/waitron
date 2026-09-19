import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { writeFileAtomic } from "./fs-atomic.js";
import { establishReservedStandbyIdentity, type StandbyIdentity } from "./reserved-identity.js";
import { ensureMirrorViewer } from "./mirror-session.js";
import type { ReservedIdentity } from "./mirror-bundle.js";
import type { Logger } from "./logger.js";

/** The file under `<stateDir>` a mirror writes at adopt and clears once its identity is established. */
export const PENDING_ADOPTION_FILE = "pending-adoption.json";

/**
 * The full standby identity + reservation an adopted mirror records at adopt for a boot to establish.
 * Persisted on disk, not in the database, because the identity it describes has no row there.
 *
 * THAT STEP CANNOT SUCCEED TODAY — this is the one place that says why; everything else about
 * adoption points here. `establishReservedStandbyIdentity` (`reserved-identity.ts`) inserts the
 * standby's `nodes` row, whose NOT NULL `location_id` references `locations`
 * (`nodes_location_id_locations_id_fk`), and an adopted mirror holds no `locations` row:
 * `adoptFromPrimary` refuses to run unless that table is EMPTY (`assertNoOperationalVenue`,
 * `packages/provisioning/src/tenant-guard.ts`), neither it nor the adoption-pending boot path inserts
 * one, nothing copies the primary's rows here, and the only `locations` insert anywhere else in the
 * tree — `applyVenue`'s, `packages/provisioning/src/venue-apply.ts` — is reached only by a
 * venue-provisioning run (the rest are test fixtures and demo scripts seeding their own in-memory
 * PGlite). Measured: that
 * establish against a migrated but empty database throws SQLSTATE 23503 naming the constraint and
 * rolls back, leaving zero `nodes` rows. `runFinishAdoption` therefore logs
 * `adoption.establish_failed` and keeps this latch, and an adopted mirror stays adoption-pending until
 * a replacement copy mechanism lands (`docs/backlog.md` → *Replication, membership & failover*).
 */
export interface PendingAdoption {
  locationId: string;
  standby: StandbyIdentity;
  nodeName: string;
  filingModule: string | null;
  taxModule: string | null;
  reserved: ReservedIdentity;
  originNodeId: string;
}

function pendingPath(stateDir: string): string {
  return join(stateDir, PENDING_ADOPTION_FILE);
}

/** Atomically write `<stateDir>/pending-adoption.json` (0600, tmp+rename) — the same secret-safe write
 * `writeTradingEnv` uses; the record carries the standby's sealed private key. */
export async function writePendingAdoption(stateDir: string, p: PendingAdoption): Promise<void> {
  await writeFileAtomic(pendingPath(stateDir), JSON.stringify(p), 0o600);
}

/** Read the pending-adoption record, or `null` when the file is absent (established, or never
 * pending). Any other read/parse error propagates — a corrupt record is a loud boot failure. */
export async function readPendingAdoption(stateDir: string): Promise<PendingAdoption | null> {
  let raw: string;
  try {
    raw = await readFile(pendingPath(stateDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(raw) as PendingAdoption;
}

/** The argument shape `establishReservedStandbyIdentity` takes — hoisted so the injectable `establish`
 * seat below matches it exactly. */
type EstablishArgs = {
  locationId: string;
  standby: StandbyIdentity;
  nodeName: string;
  filingModule: string | null;
  taxModule: string | null;
  modules: readonly WaitronModule[];
  reserved: ReservedIdentity;
};

/**
 * The boot-time finish worker for an adoption-pending mirror. If the pending file exists it attempts
 * the reserved identity (idempotent) with THIS node's enabled module set, then the ambient mirror
 * viewer, then unlinks the file and logs `adoption.established`. A throw is logged
 * (`adoption.establish_failed`) and the file is LEFT in place, so the next boot re-enters
 * adoption-pending mode and retries the whole step — which is what every boot of an adopted mirror
 * does today, for the reason in `PendingAdoption`'s header above.
 */
export async function runFinishAdoption(deps: {
  ownerDb: Database;
  ring: KeyRing;
  stateDir: string;
  modules: readonly WaitronModule[];
  establish?: (args: EstablishArgs) => Promise<void>;
  ensureViewer?: () => Promise<void>;
  log: Logger;
}): Promise<void> {
  const establish =
    deps.establish ??
    ((args) => establishReservedStandbyIdentity({ ownerDb: deps.ownerDb, ring: deps.ring }, args));
  const ensureViewer = deps.ensureViewer ?? (() => ensureMirrorViewer(deps.ownerDb));

  const pending = await readPendingAdoption(deps.stateDir);
  if (pending === null) return; // established (file unlinked) or never pending — nothing to finish.
  try {
    // establish FIRST (its inserts FK to the venue's rows), then the ambient viewer, then clear the
    // latch — order matters: the file must survive a throw in either step so the next boot retries.
    // The viewer is NOT what blocks a mirror: `ensureMirrorViewer` run against a migrated but empty
    // database succeeds (measured), and `persons` declares no foreign key at all
    // (`packages/identity/drizzle/0000_identity_baseline.sql`).
    await establish({
      locationId: pending.locationId,
      standby: pending.standby,
      nodeName: pending.nodeName,
      filingModule: pending.filingModule,
      taxModule: pending.taxModule,
      modules: deps.modules,
      reserved: pending.reserved,
    });
    await ensureViewer();
    await rm(pendingPath(deps.stateDir), { force: true });
    deps.log("info", "adoption.established", { nodeId: pending.standby.nodeId });
  } catch (error) {
    // Never fatal here: log and leave the latch file, so the next boot re-enters adoption-pending
    // mode and retries the whole step.
    deps.log("error", "adoption.establish_failed", { code: codeOf(error) });
  }
}
