import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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
import type { HandoverOperation } from "@waitron/node-db";
import { modulePreparationMergeFits, quoteIdent, unknownHashes } from "@waitron/provisioning";
import { isAppError, type ErrorCode } from "@waitron/shared";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { offeredAuthoriser } from "./handover-acceptance.js";
import { digestBytes } from "./handover-capture.js";
import { isCopyIntact } from "./handover-integrity.js";
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

/**
 * What one received file, with its one indicator, has already answered. Whoever holds the file
 * holds this beside it for as long as it keeps the file.
 */
export interface CopyFileChecks {
  bytesAndIntegrity?: true;
  moduleChecks?: Refusal | null;
}

export interface CompareOptions {
  found: CopyFileChecks;
  signal?: AbortSignal;
}

const refuse = (reason: ErrorCode, detail: CanonicalValue = {}): Refusal => ({
  ok: false,
  reason,
  detail,
});

function forget(found: CopyFileChecks): void {
  delete found.bytesAndIntegrity;
  delete found.moduleChecks;
}

function fileDiffers(found: CopyFileChecks): Refusal {
  forget(found);
  return refuse("handover.copy_mismatch");
}

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
  { found, signal }: CompareOptions,
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
  const remembered = found.bytesAndIntegrity === true;
  // After a throw or an unreadable summary the file may be what failed, and only reading it from
  // nothing would say so.
  try {
    const answer = await compareFile(
      deps,
      operation,
      body,
      copyPath,
      { found, signal },
      remembered,
    );
    if (remembered && !answer.ok && answer.reason === "handover.summary_unreadable") forget(found);
    return answer;
  } catch (error) {
    if (remembered) forget(found);
    throw error;
  }
}

async function compareFile(
  deps: CompareDeps,
  operation: HandoverOperation,
  body: FinalStateIndicator,
  copyPath: string,
  { found, signal }: CompareOptions,
  remembered: boolean,
): Promise<CompareOutcome> {
  if (remembered) {
    if (!(await stillSameSize(copyPath, body))) return fileDiffers(found);
  } else {
    if (!(await holdsDescribedBytes(copyPath, body))) return refuse("handover.copy_mismatch");
    if (!(await isCopyIntact(copyPath, signal === undefined ? {} : { signal }))) {
      return refuse("handover.copy_damaged");
    }
    found.bytesAndIntegrity = true;
  }

  const copy = await openBackupQuery(copyPath);
  let answer: CompareOutcome;
  try {
    answer = (await aheadOfThisImage(copy.query, deps.migrationsRoot)) ??
      modulesDiffer(body, deps.modules) ??
      (await behindThisImage(copy.query, deps.modules, deps.migrationsRoot)) ??
      (await rememberedModuleChecks(found, deps.modules, copy.query)) ??
      (await settingsRefused(deps, body)) ??
      (await summaryRefused(deps.modules, copy.query, body)) ??
      (await destinationRefused(deps, copy.query)) ??
      (await authoriserRefused(deps, operation.operationId, copy.query)) ?? { ok: true };
  } finally {
    await copy.close();
  }
  // What this try did not check again was answered by the file as it then was. Only at the end, so
  // a wait on a setting reads the file no more often.
  if (answer.ok && remembered && !(await holdsDescribedBytes(copyPath, body))) {
    return fileDiffers(found);
  }
  return answer;
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

/** What a kept file's checks cannot see of a file gone or cut short, without reading it again. */
async function stillSameSize(path: string, body: FinalStateIndicator): Promise<boolean> {
  try {
    return (await stat(path)).size === body.snapshot.bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
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
    const hashes = await journalOf(query, set.table);
    const unknownMigrations = unknownHashes(hashes, imageMigrationHashes(set, root));
    if (unknownMigrations.length > 0) {
      return refuse("provisioning.database_ahead", { set: set.name, unknownMigrations });
    }
  }
  return null;
}

async function journalOf(query: BackupQuery, table: string): Promise<string[]> {
  const hashes: string[] = [];
  for await (const row of query.rows(`select hash from ${quoteIdent(table)}`)) {
    hashes.push(String(row.hash));
  }
  return hashes;
}

/**
 * Only the sets this box switches on: the old box's start migrates those, so its copy is level with
 * its image there, and a set switched off long ago may rightly stand behind. Module versions cannot
 * find this: every module's is `0.0.0`. A module's check or summary must not read a schema older
 * than its code.
 */
async function behindThisImage(
  query: BackupQuery,
  modules: readonly WaitronModule[],
  root: string | null,
): Promise<Refusal | null> {
  for (const { migrations: set } of modules) {
    if (set.database === "node" || !(await hasTable(query, set.table))) continue;
    const held = await journalOf(query, set.table);
    if (unknownHashes(imageMigrationHashes(set, root), held).length > 0) {
      return refuse("handover.modules_differ", { set: set.name });
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

async function rememberedModuleChecks(
  found: CopyFileChecks,
  modules: readonly WaitronModule[],
  query: BackupQuery,
): Promise<Refusal | null> {
  if (found.moduleChecks !== undefined) return found.moduleChecks;
  const answer = await moduleCheckRefused(modules, query);
  // A check that threw says nothing about the file, so the next try asks it again.
  if (answer?.reason !== "handover.copy_check_failed") found.moduleChecks = answer;
  return answer;
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

async function destinationRefused(deps: CompareDeps, query: BackupQuery): Promise<Refusal | null> {
  const ownKey = nodeSigningPublicKey(await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId));
  for await (const row of query.rows("select public_key from nodes where id = ?", [deps.nodeId])) {
    if (row.public_key === ownKey) return null;
  }
  return refuse("handover.copy_lacks_destination");
}

async function authoriserRefused(
  deps: CompareDeps,
  operationId: string,
  query: BackupQuery,
): Promise<Refusal | null> {
  const authorisedBy = await offeredAuthoriser(deps, operationId);
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
