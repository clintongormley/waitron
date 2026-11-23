import { type KeyRing } from "@waitron/credentials";
import { peerBodyLimit } from "./peer-route-limits.js";
import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import {
  openVenueDatabase,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
  type DeploymentEnvironment,
} from "@waitron/db";

import {
  ACTIVATED_OR_LATER,
  isOperationId,
  isSha256Hex,
  refuseRequest,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  personIdForLoginEmail,
  persons,
  pinThrottleIdle,
  pinThrottleRetryAfterSeconds,
  pinThrottleUnlockAt,
  withInspectorAdmitted,
} from "@waitron/identity";
import { servingPrimaryNodeId, type CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import {
  clearTakeFailuresTx,
  readHandoverOperation,
  readNodeMode,
  readOpenHandoverOperation,
  readPairLink,
  readTakeFailures,
  recordTakeFailureTx,
  type HandoverOperation,
} from "@waitron/node-db";
import { inTurn } from "@waitron/provisioning";
import { codeOf, createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { SCRATCH_DIR } from "@waitron/store";
import type { FollowProgress } from "@waitron/stream";
import {
  askPeerStatus,
  isRecord,
  isRestriction,
  originOf,
  readVenueAuthority,
  type AskPeerStatusDeps,
  type SilentReason,
} from "./boot-peer-check.js";
import { checkEmergencyCopy, type EmergencyCopy } from "./handover-emergency-check.js";
import { handoverSignInAttempt } from "./handover-preparation.js";
import {
  createSwitchChallenges,
  parseSwitchSignIn,
  SWITCH_SIGN_IN_STATUS,
  precheckSwitchCredentials,
  switchCredentials,
  type SwitchSignIn,
  type SwitchSignInRequest,
} from "./handover-switch-proof.js";
import { managementSite } from "./request-from-box.js";
import { currentBinding, peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandoverTx, beginHandoverTx, readHandoverEnvelope } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { assertHeldDocumentReadable } from "./membership-trust.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";
import { stageBackupAsCopy } from "./handover-copy-from-backup.js";
import { followedCopyId, stageFollowedAsCopy } from "./handover-copy-from-follow.js";
import {
  discardStagedCopy,
  readSelectedCopy,
  readStagedCopy,
  SELECTED_COPY_SOURCES,
} from "./handover-copy-selection.js";
import { readUpload } from "./setup-recovery-preparation-api.js";
import { MAX_RESTORE_UPLOAD_BYTES } from "./setup-api.js";

export interface Declaration {
  binding: HandoverBinding;
  wordingVersion: "a1018-emergency-v2";
  locale: "en" | "es";
  statements: { sourceSwitchedOff: true; noParallelRecovery: true; missingTailAccepted: true };
  reason: string;
  lastCopy: EmergencyCopy;
  provider: null;
  actor: { personId: string; method: "password" | "password+totp" | "passkey" };
  declaredAtMs: number;
  replaces: string | null;
}
interface Deps {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  ring: KeyRing;
  /** Holds `tls/ca.crt`, the venue authority the source's certificate must verify under. */
  stateDir: string;
  venueDir: string;
  modules: readonly WaitronModule[];
  origin: string;
  /** The passkey relying party, `config.managementRpId`. */
  rpId: string;
  credentialKeyRing: KeyRing;
  passwordThrottle?: PasswordThrottle;
  fetch?: AskPeerStatusDeps["fetch"];
  follow?: {
    stopForSwitch(options: {
      catchUpMs: number;
    }): Promise<
      | { kind: "stopped"; generation: string; appliedTXID: string; path: string }
      | { kind: "catching-up"; progress: FollowProgress | null }
    >;
    progress(): FollowProgress | null;
    restart(): void;
    migrationsRoot: string | null;
  };
  backup?: {
    readRecoveryKey(): Promise<string | undefined>;
    environment: DeploymentEnvironment;
    migrationsRoot: string | null;
    restart(): void;
    uploadLimit?: number;
  };
}

export interface EmergencyHandover {
  assertMayActivate(operation: HandoverOperation, signal?: AbortSignal): Promise<void>;
  /** The switch's passkey challenges and proof, which preparation and activation take too. */
  switchSignIn: SwitchSignIn;
}

const STATUS = {
  "password.invalid": 401,
  "password.throttled": 429,
  ...SWITCH_SIGN_IN_STATUS,
  "totp.required": 401,
  "authorization.not_permitted": 403,
  "node.operation_page_required": 403,
  "handover.request_invalid": 400,
  "handover.copy_damaged": 409,
  "handover.chain_broken": 409,
  "handover.copy_check_failed": 409,
  "handover.copy_mismatch": 409,
  "handover.controlled_unresolved": 409,
  "handover.source_still_answering": 409,
  "handover.source_not_established": 409,
  "handover.step_out_of_order": 409,
  "node.read_only": 409,
  "setup.request_invalid": 400,
  "handover.copy_predates_destination": 409,
  "handover.backup_key_missing": 409,
  "backup.new_recovery_key_too_short": 400,
  "recovery.passphrase_invalid": 422,
  "backup.artifact_invalid": 422,
  "backup.archive_invalid": 422,
  "restore.manifest_invalid": 422,
  "restore.archive_resource_limit": 507,
  "restore.environment_mismatch": 409,
  "restore.schema_too_new": 409,
  "provisioning.database_ahead": 409,
} as const;

function isCopySource(value: unknown): value is EmergencyCopy["source"] {
  return value === "mirror-copy" || SELECTED_COPY_SOURCES.some((source) => source === value);
}

function parse(raw: unknown) {
  if (!isRecord(raw)) refuseRequest("body");
  const { operationId, statements, reason, locale, provider } = raw;
  if (!isOperationId(operationId)) refuseRequest("operationId");
  for (const key of ["sourceSwitchedOff", "noParallelRecovery", "missingTailAccepted"])
    if (!isRecord(statements) || statements[key] !== true) refuseRequest(`statements.${key}`);
  if (!isRecord(statements) || Object.keys(statements).length !== 3) refuseRequest("statements");
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 500)
    refuseRequest("reason");
  if (locale !== "en" && locale !== "es") refuseRequest("locale");
  if (provider !== undefined && provider !== null) refuseRequest("provider");
  const expectedCopy = raw.expectedCopy;
  if (
    !isRecord(expectedCopy) ||
    !isSha256Hex(expectedCopy.identifier) ||
    !(
      expectedCopy.lastChangeAtMs === null ||
      (typeof expectedCopy.lastChangeAtMs === "number" &&
        Number.isFinite(expectedCopy.lastChangeAtMs))
    )
  )
    refuseRequest("expectedCopy");
  const source: unknown = expectedCopy.source;
  if (!isCopySource(source)) refuseRequest("expectedCopy.source");
  if (source !== "mirror-copy" && !isSha256Hex(expectedCopy.sourceId))
    refuseRequest("expectedCopy.sourceId");
  return {
    operationId,
    statements: {
      sourceSwitchedOff: true,
      noParallelRecovery: true,
      missingTailAccepted: true,
    } as const,
    reason,
    locale: locale as "en" | "es",
    signIn: raw.signIn,
    expectedCopy: {
      ...(source === "mirror-copy"
        ? { source }
        : { source, sourceId: expectedCopy.sourceId as string }),
      identifier: expectedCopy.identifier,
      lastChangeAtMs: expectedCopy.lastChangeAtMs,
    },
  };
}

/** The mark dies with the process; activation checks the saved copy again after a restart. */
export function mountHandoverEmergencyApi(
  app: Hono,
  deps: Deps,
  log: Logger = () => {},
): EmergencyHandover {
  const checked = new Set<string>();
  const throttle = deps.passwordThrottle ?? createPasswordThrottle();
  const boundary = createErrorBoundary(STATUS, "handover-emergency.failed");
  const switchSignIn: SwitchSignIn = {
    node: deps.node,
    ring: deps.ring,
    nodeId: deps.nodeId,
    rpId: deps.rpId,
    origin: deps.origin,
    challenges: createSwitchChallenges(),
  };
  async function sourceSilent(sourceNodeId: string, activating: boolean) {
    const held = await readNodeMembership(deps.db);
    const source = held?.body.nodes.find((n) => n.nodeId === sourceNodeId);
    const own = held?.body.nodes.find((n) => n.nodeId === deps.nodeId);
    if (source !== undefined && originOf(source.contactUrl) === originOf(deps.origin))
      throw new AppError("handover.source_not_established", {});
    const authority = await readVenueAuthority(deps.stateDir);
    let reason: SilentReason | undefined;
    const answer = await askPeerStatus({
      sign: (body) => signAsThisBox(deps, "query", body),
      publicKeyOf: await peerKeyOf(deps),
      ownOrigin: own?.contactUrl || deps.origin,
      authorityOf: () => authority,
      onSilent: (_id, why) => {
        reason = why;
      },
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    })({ nodeId: sourceNodeId, url: source?.contactUrl ?? "", standing: "serving-primary" });
    if (answer === null && reason === "unreachable") return;
    if (answer === null) throw new AppError("handover.source_not_established", {});
    if (
      activating &&
      isRestriction(answer.restriction) &&
      answer.restriction?.successorNodeId === deps.nodeId
    )
      return;
    throw new AppError("handover.source_still_answering", {
      sourceServersUrl: new URL("/servers", originOf(source!.contactUrl)).href,
    });
  }
  async function authenticate(c: Context, signIn: SwitchSignInRequest, db: Database = deps.db) {
    if (signIn.kind !== "password") {
      const { personId } = await switchCredentials(c, switchSignIn, db, signIn);
      return { personId, method: "passkey" as const };
    }
    const { password, totp } = signIn;
    const personId = await personIdForLoginEmail(db, signIn.email);
    const credentials = { personId };
    // End the sign-in transaction before checking the copy or the network. Only a passing check
    // reaches the separate node transaction, so neither slow operation holds a write lock.
    return handoverSignInAttempt(throttle, credentials, () =>
      inTurn(db, personId, async () => {
        const secret = await checkManagerPassword(db, { personId }, password);
        return withTransaction(db, async (tx) => {
          const session = await loginManagerById(tx, {
            personId,
            password,
            ...(totp === undefined ? {} : { totp }),
            totpKeyRing: deps.credentialKeyRing,
            checked: secret,
          });
          await withInspectorAdmitted(() =>
            authorizeManager(tx, { managementSessionId: session.token, permission: "node.manage" }),
          );
          await endManagementSession(tx, session.token, "operation_finished");
          const [person] = await tx
            .select({ totpSecret: persons.totpSecret })
            .from(persons)
            .where(eq(persons.id, personId));
          return {
            personId,
            method:
              person!.totpSecret === null ? ("password" as const) : ("password+totp" as const),
          };
        });
      }),
    );
  }
  async function declarationFor(operationId: string): Promise<Declaration> {
    const envelope = JSON.parse(
      await readHandoverEnvelope(deps, operationId, "emergency_declared"),
    ) as SignedHandoverEnvelope<Declaration>;
    return envelope.body;
  }
  async function compareCopy(
    expected: EmergencyCopy,
    signal?: AbortSignal,
  ): Promise<EmergencyCopy> {
    const copy = await checkEmergencyCopy({ ...deps, signal });
    if (!isDeepStrictEqual(copy, expected)) throw new AppError("handover.copy_mismatch", {});
    return copy;
  }
  async function mirrorSource() {
    if ((await readNodeMode(deps.node, deps.nodeId)).mode !== "mirror")
      throw new AppError("node.read_only", {});
    const held = await readNodeMembership(deps.db);
    assertHeldDocumentReadable(held);
    const sourceNodeId = held === null ? undefined : servingPrimaryNodeId(held);
    if (sourceNodeId === undefined || sourceNodeId === deps.nodeId)
      throw new AppError("handover.source_not_established", {});
    return { sourceNodeId, source: held!.body.nodes.find((node) => node.nodeId === sourceNodeId)! };
  }
  function replaceable(old: HandoverOperation | null, sourceNodeId: string): void {
    if (
      old !== null &&
      (old.role !== "destination" ||
        old.scenario !== "controlled" ||
        old.state !== "prepared" ||
        old.sourceNodeId !== sourceNodeId)
    )
      throw new AppError("handover.controlled_unresolved", { operationId: old.operationId });
  }
  async function preview(c: Context, raw: unknown) {
    if (!isRecord(raw)) refuseRequest("body");
    await authenticate(c, parseSwitchSignIn(c, raw.signIn));
    const { sourceNodeId, source } = await mirrorSource();
    const operation = await readOpenHandoverOperation(deps.node, deps.nodeId);
    if (
      operation !== null &&
      (operation.scenario !== "emergency" || operation.role !== "destination")
    )
      replaceable(operation, sourceNodeId);
    const declaration =
      operation?.scenario === "emergency" ? await declarationFor(operation.operationId) : null;
    const copy =
      declaration === null
        ? await checkEmergencyCopy({ ...deps, signal: c.req.raw.signal })
        : await compareCopy(declaration.lastCopy, c.req.raw.signal);
    await sourceSilent(sourceNodeId, declaration !== null);
    // The pair link turns `copied` when joining finishes, after the copy taken then is placed.
    const link = await readPairLink(deps.node, deps.nodeId);
    return {
      sourceNodeId,
      destinationNodeId: deps.nodeId,
      sourceServersUrl: new URL("/servers", originOf(source.contactUrl)).href,
      copy,
      joinedAtMs:
        link?.role === "serves" && link.state === "copied" ? link.updatedAt.getTime() : null,
      operation:
        operation === null
          ? null
          : {
              operationId: operation.operationId,
              reason: declaration?.reason ?? null,
              declaredAtMs: declaration?.declaredAtMs ?? null,
            },
    };
  }
  app.use("/api/node/handover/emergency/preview", peerBodyLimit(1048576));
  app.post("/api/node/handover/emergency/preview", (c) =>
    boundary(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const body = await readJsonBody<unknown>(c);
      return c.json(await inTurn(deps.node, "handover-emergency", () => preview(c, body)));
    }),
  );
  app.post("/api/node/handover/emergency/backup", (c) =>
    boundary(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const { payload, artifact } = await readUpload(
        c,
        deps.backup?.uploadLimit ?? MAX_RESTORE_UPLOAD_BYTES,
      );
      if (!isRecord(payload) || artifact === undefined) refuseRequest("artifact");
      if (payload.recoveryKey !== undefined && typeof payload.recoveryKey !== "string")
        refuseRequest("recoveryKey");
      return inTurn(deps.node, "handover-emergency", async () => {
        await authenticate(c, parseSwitchSignIn(c, payload.signIn));
        const { sourceNodeId } = await mirrorSource();
        const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
        if (open !== null)
          throw new AppError("handover.controlled_unresolved", { operationId: open.operationId });
        await sourceSilent(sourceNodeId, false);
        if (deps.backup === undefined) throw new AppError("handover.backup_key_missing", {});
        const parent = join(deps.stateDir, SCRATCH_DIR);
        await mkdir(parent, { recursive: true, mode: 0o700 });
        const folder = await mkdtemp(join(parent, "handover-upload-"));
        try {
          const artifactPath = join(folder, "archive.enc");
          await writeFile(artifactPath, artifact, { mode: 0o600 });
          await stageBackupAsCopy({
            ...deps,
            ...deps.backup,
            signal: c.req.raw.signal,
            artifactPath,
            ...(payload.recoveryKey === undefined
              ? {}
              : { recoveryKey: payload.recoveryKey as string }),
          });
        } finally {
          await rm(folder, { recursive: true, force: true });
        }
        const response = c.json({ restarting: true });
        setTimeout(deps.backup.restart, 0);
        return response;
      });
    }),
  );
  async function refuseRepeatedFailures(): Promise<void> {
    const failed = await readTakeFailures(deps.node, deps.nodeId);
    if (failed === null) return;
    const now = Date.now();
    const lastAt = failed.lastFailedAt.getTime();
    const unlockAt = pinThrottleUnlockAt(failed.failures, lastAt);
    if (!pinThrottleIdle(lastAt, now) && now < unlockAt)
      throw new AppError("password.throttled", {
        retryAfterSeconds: pinThrottleRetryAfterSeconds(unlockAt, now),
      });
  }
  /** Every failed take after the stop restarts the box, so each counts, whatever refused it. */
  async function countFailedTake(): Promise<void> {
    await withNodeTransaction(deps.node, async (tx) => {
      const failed = await readTakeFailures(tx, deps.nodeId);
      if (failed !== null && pinThrottleIdle(failed.lastFailedAt.getTime(), Date.now()))
        await clearTakeFailuresTx(tx, deps.nodeId);
      await recordTakeFailureTx(tx, deps.nodeId, new Date());
    }).catch((written: unknown) =>
      log("warn", "handover.take_failure_not_counted", { errorCode: codeOf(written) }),
    );
  }
  async function signInAgainstFollowed(
    c: Context,
    signIn: SwitchSignInRequest,
    path: string,
  ): Promise<void> {
    const followed = await openVenueDatabase(dirname(path));
    try {
      await authenticate(c, signIn, followed.venue);
    } finally {
      await followed.close();
    }
  }
  async function take(c: Context, raw: unknown) {
    // A sign-in that could never pass is refused before anything is stopped.
    const signIn = parseSwitchSignIn(c, raw);
    if (signIn.kind === "malformed") refuseRequest("signIn");
    if (signIn.kind === "proof" && !signIn.proof)
      throw new AppError("password.invalid", {}, { reason: "missing" });
    const { sourceNodeId } = await mirrorSource();
    const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
    if (open !== null)
      throw new AppError("handover.controlled_unresolved", { operationId: open.operationId });
    const staged = await readStagedCopy(deps.stateDir);
    const placed = await readSelectedCopy(deps.stateDir);
    if (staged?.source === "selected-backup" || placed?.source === "selected-backup")
      return { state: "taken" as const };
    if (staged !== null) return { state: "restarting" as const };
    const seen = deps.follow?.progress() ?? null;
    if (
      placed !== null &&
      (seen === null ||
        seen.state === "rebuilding" ||
        (seen.appliedTXID !== null &&
          followedCopyId({ generation: seen.generation, appliedTXID: seen.appliedTXID }) ===
            placed.sourceId))
    )
      return { state: "taken" as const };
    const follow = deps.follow;
    // The page asks again every 2 seconds, so a follower last seen behind answers without asking
    // the main box, and the stop below looks once rather than holding this turn while it waits.
    if (
      follow === undefined ||
      seen === null ||
      seen.state !== "following" ||
      seen.appliedTXID === null ||
      seen.appliedTXID !== seen.uploadedTXID
    )
      return { state: "catching-up" as const };
    await refuseRepeatedFailures();
    // A passkey challenge this box no longer holds, or a proof that fails a check needing no copy,
    // is refused here, not after the stop restarts the box.
    await precheckSwitchCredentials(c, switchSignIn, signIn);
    await sourceSilent(sourceNodeId, false);
    let stopping = true;
    try {
      const stopped = await follow.stopForSwitch({ catchUpMs: 0 });
      if (stopped.kind === "catching-up") {
        stopping = false;
        return { state: "catching-up" as const };
      }
      await stageFollowedAsCopy(
        { ...deps, migrationsRoot: follow.migrationsRoot, signal: c.req.raw.signal },
        stopped,
      );
      try {
        await signInAgainstFollowed(c, signIn, stopped.path);
      } catch (error) {
        await discardStagedCopy(deps.stateDir);
        throw error;
      }
      // The copy is staged and the restart places it, so a count that stays is logged, not answered.
      await withNodeTransaction(deps.node, (tx) => clearTakeFailuresTx(tx, deps.nodeId)).catch(
        (written: unknown) =>
          log("warn", "handover.take_failures_not_cleared", { errorCode: codeOf(written) }),
      );
      return { state: "restarting" as const };
    } catch (error) {
      if (stopping) await countFailedTake();
      throw error;
    } finally {
      // Following never resumes in this process once stopped, so every outcome but waiting starts
      // it again; a throw from the stop itself may come after it stopped.
      if (stopping) setTimeout(follow.restart, 0);
    }
  }
  app.use("/api/node/handover/emergency/followed", peerBodyLimit(65536));
  app.post("/api/node/handover/emergency/followed", (c) =>
    boundary(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const body = await readJsonBody<unknown>(c);
      if (!isRecord(body)) refuseRequest("body");
      return c.json(await inTurn(deps.node, "handover-emergency", () => take(c, body.signIn)));
    }),
  );
  async function declare(c: Context, raw: unknown) {
    const request = parse(raw);
    const actor = await authenticate(c, parseSwitchSignIn(c, request.signIn));
    const stored = await readHandoverOperation(deps.node, deps.nodeId, request.operationId);
    if (stored !== null) {
      if (stored.scenario !== "emergency" || stored.role !== "destination")
        refuseRequest("operationId");
      const declaration = JSON.parse(
        await readHandoverEnvelope(deps, request.operationId, "emergency_declared"),
      ) as SignedHandoverEnvelope<Declaration>;
      const old = declaration.body;
      if (
        !isDeepStrictEqual(
          {
            operationId: old.binding.operationId,
            statements: old.statements,
            reason: old.reason,
            locale: old.locale,
            expectedCopy: old.lastCopy,
          },
          {
            operationId: request.operationId,
            statements: request.statements,
            reason: request.reason,
            locale: request.locale,
            expectedCopy: request.expectedCopy,
          },
        )
      )
        refuseRequest("operationId");
      if (!checked.has(request.operationId) && !ACTIVATED_OR_LATER.includes(stored.state)) {
        await compareCopy(old.lastCopy, c.req.raw.signal);
        checked.add(request.operationId);
      }
      return { declaration };
    }
    const { sourceNodeId } = await mirrorSource();
    const binding = await currentBinding(
      deps,
      "emergency",
      sourceNodeId,
      deps.nodeId,
      request.operationId,
    );
    const previous = await readOpenHandoverOperation(deps.node, deps.nodeId);
    replaceable(previous, sourceNodeId);
    const lastCopy = await compareCopy(request.expectedCopy, c.req.raw.signal);
    const body: Declaration = {
      binding,
      wordingVersion: "a1018-emergency-v2",
      locale: request.locale,
      statements: request.statements,
      reason: request.reason,
      lastCopy,
      provider: null,
      actor,
      declaredAtMs: Date.now(),
      replaces: previous?.operationId ?? null,
    };
    const declaration = await signAsThisBox(deps, "declaration", body as unknown as CanonicalValue);
    await sourceSilent(sourceNodeId, false);
    await withNodeTransaction(deps.node, async (tx) => {
      const open = await readOpenHandoverOperation(tx, deps.nodeId);
      replaceable(open, sourceNodeId);
      if (open?.operationId !== previous?.operationId)
        throw new AppError("handover.controlled_unresolved", {});
      if (open !== null)
        await advanceHandoverTx(tx, deps.nodeId, open.operationId, "replaced", {
          replacedBy: request.operationId,
        });
      await beginHandoverTx(tx, deps.nodeId, binding, "destination");
      await advanceHandoverTx(
        tx,
        deps.nodeId,
        request.operationId,
        "emergency_declared",
        {},
        declaration,
      );
    });
    checked.add(request.operationId);
    return { declaration };
  }
  app.use("/api/node/handover/emergency/declare", peerBodyLimit(1048576));
  app.post("/api/node/handover/emergency/declare", (c) =>
    boundary(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      const body = await readJsonBody<unknown>(c);
      return c.json(await inTurn(deps.node, "handover-emergency", () => declare(c, body)));
    }),
  );
  app.post("/api/node/handover/emergency/passkey-challenge", (c) =>
    boundary(c, log, async () => {
      c.header("Cache-Control", "no-store");
      requireNodeOperationHttps(c);
      return c.json({ options: await switchSignIn.challenges.make(managementSite(c, deps).rpId) });
    }),
  );
  return {
    switchSignIn,
    async assertMayActivate(operation, signal) {
      if (!checked.has(operation.operationId)) {
        await compareCopy((await declarationFor(operation.operationId)).lastCopy, signal);
        checked.add(operation.operationId);
      }
      await sourceSilent(operation.sourceNodeId, true);
    },
  };
}
