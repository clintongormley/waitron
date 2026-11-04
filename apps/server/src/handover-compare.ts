import { createReadStream } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import type { Database, NodeDatabase } from "@waitron/db";
import {
  bindingFingerprint,
  parseIndicator,
  verifyEnvelope,
  type FinalStateIndicator,
  type RetainedRevision,
} from "@waitron/handover";
import { personRole, roleHasPermission, type PersonRoleValue } from "@waitron/identity";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import { imageMigrationHashes, manifestSets } from "@waitron/migrations";
import { checkHandoverCopy, collectHandoverSummaries, type WaitronModule } from "@waitron/module";
import { readHandoverEvent, type HandoverOperation } from "@waitron/node-db";
import { modulePreparationMergeFits, quoteIdent, unknownHashes } from "@waitron/provisioning";
import { isAppError, type ErrorCode } from "@waitron/shared";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { digestBytes } from "./handover-capture.js";
import {
  offerSettingsDifference,
  readOfferSettings,
  type OfferSettings,
} from "./handover-manifest.js";
import { peerKeyOf } from "./handover-signing.js";
import { readNodeIdentityKey } from "./node-identity.js";
import "./errors.js";

export interface CompareDeps {
  readonly db: Database;
  readonly node: NodeDatabase;
  readonly ring: KeyRing;
  readonly nodeId: string;
  readonly stateDir: string;
  /** This box's enabled modules: those whose checks and summaries it runs. */
  readonly modules: readonly WaitronModule[];
  readonly migrationsRoot: string | null;
}

export type CompareOutcome =
  { ok: true } | { ok: false; reason: ErrorCode; detail: CanonicalValue };

type Refusal = Extract<CompareOutcome, { ok: false }>;

const refuse = (reason: ErrorCode, detail: CanonicalValue = {}): Refusal => ({
  ok: false,
  reason,
  detail,
});

/** A throw carrying `code` is `reason`'s refusal; anything else is a fault and stays a throw. */
function refusalOr(error: unknown, code: ErrorCode, reason: ErrorCode = code): Refusal {
  if (isAppError(error) && error.code === code) {
    return refuse(reason, error.params as unknown as CanonicalValue);
  }
  throw error;
}

/**
 * Whether the file the spare received can stand in for the old box's venue database. It reads the
 * copy, the spare's own files and node.db, and asks the old box nothing. `indicator` is whatever the
 * old box answered, so it arrives unchecked.
 */
export async function compareFinalCopy(
  deps: CompareDeps,
  operation: HandoverOperation,
  indicator: unknown,
  copyPath: string,
): Promise<CompareOutcome> {
  let body: FinalStateIndicator;
  try {
    body = parseIndicator((indicator as { body?: unknown } | null)?.body);
  } catch (error) {
    return refusalOr(error, "handover.indicator_mismatch");
  }

  const verdict = verifyEnvelope(indicator, "final-state", await peerKeyOf(deps));
  if (!verdict.valid || verdict.signerNodeId !== operation.sourceNodeId) {
    return refuse("handover.indicator_untrusted");
  }
  if (bindingFingerprint(body.binding) !== operation.fingerprint) {
    return refuse("handover.indicator_mismatch", { field: "binding" });
  }
  if (!(await holdsDescribedBytes(copyPath, body))) return refuse("handover.copy_mismatch");
  if (!isIntact(copyPath)) return refuse("handover.copy_damaged");

  const copy = await openBackupQuery(copyPath);
  try {
    return (
      (await aheadOfThisImage(copy.query, deps.migrationsRoot)) ??
      modulesDiffer(body, deps.modules) ??
      (await moduleCheckRefused(deps.modules, copy.query)) ??
      (await settingsRefused(deps, body)) ??
      (await summaryRefused(deps.modules, copy.query, body)) ??
      (await destinationRefused(deps, copy.query)) ??
      (await authoriserRefused(deps, operation.operationId, copy.query)) ?? { ok: true }
    );
  } finally {
    await copy.close();
  }
}

async function holdsDescribedBytes(path: string, body: FinalStateIndicator): Promise<boolean> {
  try {
    const { sha256, bytes } = await digestBytes(createReadStream(path));
    return sha256 === body.snapshot.sha256 && bytes === body.snapshot.bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** On its own open: the copy query's authoriser refuses a pragma, and a refusal closes it. */
function isIntact(path: string): boolean {
  try {
    const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    try {
      db.exec("pragma query_only=on");
      const checks = db.prepare("pragma integrity_check").all();
      return checks.length === 1 && checks[0]!.integrity_check === "ok";
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

async function hasTable(query: BackupQuery, name: string): Promise<boolean> {
  for await (const _row of query.rows(
    "select 1 from sqlite_schema where type = 'table' and name = ?",
    [name],
  )) {
    return true;
  }
  return false;
}

/**
 * Every set this image ships, not only the enabled ones: the start that would open this copy reads
 * them all (`node-entry.ts`'s `assertNotAhead`). Runs before any module's code, which must not read
 * a schema this image does not know.
 */
async function aheadOfThisImage(query: BackupQuery, root: string | null): Promise<Refusal | null> {
  for (const set of manifestSets()) {
    if (set.database === "node" || !(await hasTable(query, set.table))) continue;
    const hashes: string[] = [];
    for await (const row of query.rows(`select hash from ${quoteIdent(set.table)}`)) {
      hashes.push(String(row.hash));
    }
    const unknownMigrations = unknownHashes(hashes, imageMigrationHashes(set, root));
    if (unknownMigrations.length > 0) {
      return refuse("provisioning.database_ahead", { set: set.name, unknownMigrations });
    }
  }
  return null;
}

function modulesDiffer(
  body: FinalStateIndicator,
  modules: readonly WaitronModule[],
): Refusal | null {
  const held = modules.map(({ name, version }) => `${name}@${version}`).sort();
  const listed = body.snapshot.modules.map(({ name, version }) => `${name}@${version}`).sort();
  return held.join("\n") === listed.join("\n") ? null : refuse("handover.modules_differ");
}

async function moduleCheckRefused(
  modules: readonly WaitronModule[],
  query: BackupQuery,
): Promise<Refusal | null> {
  let answer: Awaited<ReturnType<typeof checkHandoverCopy>>;
  try {
    answer = await checkHandoverCopy(modules, query);
  } catch (error) {
    return refusalOr(error, "handover.copy_check_failed");
  }
  return answer.ok ? null : refuse("handover.chain_broken", { module: answer.module });
}

function rowOf(body: FinalStateIndicator, item: string) {
  return body.nodeLocal.find((row) => row.item === item);
}

async function settingsRefused(
  deps: CompareDeps,
  body: FinalStateIndicator,
): Promise<Refusal | null> {
  let own: OfferSettings;
  try {
    own = await readOfferSettings(
      deps.stateDir,
      deps.ring,
      "handover.destination_settings_unreadable",
    );
  } catch (error) {
    return refusalOr(error, "handover.destination_settings_unreadable");
  }
  const difference = offerSettingsDifference(
    {
      backupSettings: rowOf(body, "backup.env")?.sha256 ?? null,
      moduleSettings: rowOf(body, "modules.json")?.sha256 ?? null,
      ringVersions: rowOf(body, "secrets.env")?.ringVersions ?? [],
    },
    own,
  );
  if (difference !== null) return refuse(difference);
  const incoming: readonly RetainedRevision[] =
    rowOf(body, "module-preparation-state.json")?.revisions ?? [];
  return (await modulePreparationMergeFits({ stateDir: deps.stateDir }, incoming))
    ? null
    : refuse("handover.preparation_state_too_large");
}

/**
 * The summaries are recomputed from the received bytes because a matching digest proves only that
 * M2 holds what M1 sent, not that M1 sent what it summarised.
 */
async function summaryRefused(
  modules: readonly WaitronModule[],
  query: BackupQuery,
  body: FinalStateIndicator,
): Promise<Refusal | null> {
  let own: Record<string, CanonicalValue>;
  try {
    own = await collectHandoverSummaries(modules, query);
  } catch (error) {
    return refusalOr(error, "handover.summary_failed", "handover.summary_unreadable");
  }
  const signed = body.modulesSummary;
  for (const module of new Set([...Object.keys(own), ...Object.keys(signed)])) {
    if (
      !Object.hasOwn(own, module) ||
      !Object.hasOwn(signed, module) ||
      canonicalize(own[module]!) !== canonicalize(signed[module]!)
    ) {
      return refuse("handover.summary_mismatch", { module });
    }
  }
  return null;
}

/** A start on this copy needs this box's row and its location (`boot.ts`'s `readNodeLocation`). */
async function destinationRefused(deps: CompareDeps, query: BackupQuery): Promise<Refusal | null> {
  const ownKey = nodeSigningPublicKey(await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId));
  for await (const row of query.rows(
    `select n.public_key from nodes n join locations l on l.id = n.location_id where n.id = ?`,
    [deps.nodeId],
  )) {
    if (row.public_key === ownKey) return null;
  }
  return refuse("handover.copy_lacks_destination");
}

async function authoriserRefused(
  deps: CompareDeps,
  operationId: string,
  query: BackupQuery,
): Promise<Refusal | null> {
  const offer = await readHandoverEvent(deps.node, deps.nodeId, operationId, "offer");
  // A fault in Waitron: the offer route stores the offer in the transaction that begins the row.
  if (offer?.envelope == null) throw new Error(`the offer of ${operationId} is not stored`);
  const { authorisedBy } = (JSON.parse(offer.envelope) as { body: { authorisedBy: string } }).body;
  if (await hasTable(query, "persons")) {
    for await (const row of query.rows("select role, status from persons where id = ?", [
      authorisedBy,
    ])) {
      const role = String(row.role);
      if (
        row.status === "active" &&
        (personRole.enumValues as readonly string[]).includes(role) &&
        roleHasPermission(role as PersonRoleValue, "node.promote")
      ) {
        return null;
      }
    }
  }
  return refuse("handover.authoriser_not_permitted");
}
