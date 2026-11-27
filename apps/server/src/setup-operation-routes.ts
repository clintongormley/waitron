import { ALL_MODULES } from "@waitron/composition";
import { withTransaction } from "@waitron/db";
import {
  type ActiveSetupOperation,
  type FirstSetupHold,
  type SetupOperationStore,
  parseEmailSettings,
  type VenueResult,
  saveSmtpSettings,
  type MadeMasterKey,
  makeNewMasterKey,
} from "@waitron/provisioning";
import {
  type Logger,
  createErrorBoundary,
  readRawJsonBody,
  codeOf,
  readJsonBody,
} from "@waitron/server-kit";
import { isUnset, AppError, isAppError, FALLBACK_LOCALE } from "@waitron/shared";
import type { Hono, Context } from "hono";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { openingKeyFor } from "./backup-file-key.js";
import { makeMasterKeyRecoveryPack } from "./backup-recovery-pack-output.js";
import { writeBackupKeyOne } from "./backup-key-record.js";
import type { JoinedBox } from "./box-join-attempt.js";
import { labelContactUrl } from "./box-name.js";
import { isSecure } from "./encrypted-connection.js";
import { resolveLoginLocale } from "./login-locale.js";
import { saveNewMasterKey } from "./master-key-record.js";
import { sentFromThisOrigin } from "./own-page.js";
import { type RecoveryEntryContext, parseRecoveryEntryContext } from "./recovery-entry.js";
import {
  type RecoveryOperationInput,
  parseRecoveryOperationInput,
} from "./recovery-module-operation.js";
import type { SetupDeps, BucketRestoreInput } from "./setup-api-deps.js";
import {
  BUCKET_RESTORE_STATUS,
  directError,
  runProvision,
  runAdopt,
  runReset,
  runRestore,
  runBucketRestore,
  runConfiguration,
} from "./setup-api-errors.js";
import type { ArchiveUpload } from "./setup-archive-upload.js";
import { mountSetupCloudRecoverySessionRoutes } from "./setup-cloud-recovery-session-routes.js";
import {
  recordSetupCloudPublication,
  setupCloudBinding,
  type SetupCloudSignIn,
} from "./setup-cloud-sign-in.js";
import { mountSetupEmailTest } from "./setup-email-api.js";
import { mountSetupDriveRoutes } from "./setup-drive-routes.js";
import { mountSetupJoinRoutes } from "./setup-join-routes.js";
import { isUnfinishedAdopt, setupPhaseReached } from "./setup-operation.js";
import { parseProvisionPayload } from "./setup-provision-input.js";
import { mountRecoveryPreparationApi } from "./setup-recovery-preparation-api.js";
import {
  invalidRequest,
  MAX_RESTORE_UPLOAD_BYTES,
  asObject,
  asMasterKey,
  bucketRestoreSource,
  asString,
} from "./setup-request-fields.js";
import type { TradingConfig } from "./trading-config.js";
import { isJsonRequest } from "./drive-backup-files.js";
import "./errors.js";

function recoveryCredentials(
  recoveryOperationPath: string | undefined,
  operation: unknown,
  secret: unknown,
  context?: unknown,
): {
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
  recoveryContext?: RecoveryEntryContext;
} {
  if (operation === undefined && secret === undefined && context === undefined) {
    if (isUnset(recoveryOperationPath)) invalidRequest("recoveryOperation");
    return {};
  }
  const parsed = parseRecoveryOperationInput(operation);
  if (
    parsed === null ||
    parsed.binding.action !== "restore" ||
    Buffer.byteLength(JSON.stringify(parsed)) > 131072
  )
    invalidRequest("recoveryOperation");
  if (typeof secret !== "string" || secret.trim().length === 0 || Buffer.byteLength(secret) > 4096)
    invalidRequest("nodeRecoverySecret");
  const selected = context === undefined ? undefined : parseRecoveryEntryContext(context);
  if (selected === null) invalidRequest("recoveryContext");
  return {
    recoveryOperation: parsed,
    nodeRecoverySecret: secret,
    ...(selected === undefined ? {} : { recoveryContext: selected }),
  };
}
/** A restore's small fields, from its form, or from its headers when it is a bare upload. */
function restoreFields(
  form: ReadonlyMap<string, string> | undefined,
  headers: {
    masterKey: string | undefined;
    environment: string | undefined;
    oldBoxGone: string | undefined;
    recoveryOperationPath: string | undefined;
  },
) {
  if (form) {
    const answer = form.get("oldBoxGone");
    if (answer != null && answer !== "0" && answer !== "1") invalidRequest("oldBoxGone");
  }
  const masterKey =
    form === undefined ? headers.masterKey! : asMasterKey(form.get("masterKey"), "masterKey");
  const rawEnvironment = form === undefined ? headers.environment : form.get("environment");
  if (rawEnvironment !== "production" && rawEnvironment !== "preproduction")
    invalidRequest("environment");
  const oldBoxGone = (form === undefined ? headers.oldBoxGone : form.get("oldBoxGone")) === "1";
  let suppliedOperation: unknown;
  const rawOperation = form?.get("recoveryOperation");
  if (rawOperation !== undefined && rawOperation !== null) {
    if (typeof rawOperation !== "string" || Buffer.byteLength(rawOperation) > 131072)
      invalidRequest("recoveryOperation");
    try {
      suppliedOperation = JSON.parse(rawOperation);
    } catch {
      invalidRequest("recoveryOperation");
    }
  }
  const credentials = recoveryCredentials(
    headers.recoveryOperationPath,
    suppliedOperation,
    form?.get("nodeRecoverySecret") ?? (rawOperation == null ? undefined : masterKey),
    (() => {
      const raw = form?.get("recoveryContext");
      if (raw === undefined || raw === null) return undefined;
      if (typeof raw !== "string" || Buffer.byteLength(raw) > 2048)
        invalidRequest("recoveryContext");
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return invalidRequest("recoveryContext");
      }
    })(),
  );
  return { masterKey, rawEnvironment, oldBoxGone, credentials } as const;
}
export const MAX_CONFIGURATION_UPLOAD_BYTES = 64 * 1024 * 1024;
// Finish joining reads nothing from its body, so every resend counts as the same request.
const JOIN_ADOPT_REQUEST_HASH = createHash("sha256").update("adopt-joined").digest("hex");

export function mountSetupOperationRoutes(
  app: Hono,
  deps: SetupDeps,
  log: Logger,
  holds: WeakMap<Request, FirstSetupHold>,
  runOperation: <T>(
    request: Request,
    kind: Parameters<SetupOperationStore["run"]>[0],
    hash: string,
    body: (operation: ActiveSetupOperation) => Promise<T>,
  ) => Promise<T>,
  restartAfterReply: (
    c: Context,
    requestRestart: () => void,
    handle: (mustRestart: () => void) => Promise<Response>,
  ) => Promise<Response>,
  cloudSignIn: SetupCloudSignIn | undefined,
) {
  // The one-shot setup latch, one per mount and so one per booted process. Every setup POST except
  // cloud recovery's start and start-again checks it, so a start of one latches out a concurrent
  // start of another. `applyVenue` mints a FRESH SIF/hash chain on every run and `provisionVenue`'s
  // taxpayer-exists check is not atomic with it, so two concurrent provisions could each start a
  // second, unrecoverable chain (CLAUDE.md §5); the latch prevents the concurrent case, the
  // taxpayer-exists check backstops a sequential re-POST.
  let provisioning = false;
  let fiscalTesting = false;
  let configurationStaging = false;
  const emailTesting = mountSetupEmailTest(
    app,
    log,
    deps.sendEmailTest,
    () => provisioning || fiscalTesting || configurationStaging,
  );

  const setupBusy = () => provisioning || fiscalTesting || configurationStaging || emailTesting();

  mountRecoveryPreparationApi(app, deps, log, {
    uploadLimit: MAX_RESTORE_UPLOAD_BYTES,
    hold: (request) => holds.get(request),
    busy: setupBusy,
    setBusy: (value) => {
      provisioning = value;
    },
    run: createErrorBoundary(
      { ...BUCKET_RESTORE_STATUS, "setup.not_ready": 503, "restore.staged_copy_missing": 409 },
      "setup.restore_failed",
    ),
  });
  mountSetupDriveRoutes(app, deps, log, {
    busy: setupBusy,
    setBusy: (value) => {
      provisioning = value;
    },
  });

  app.post("/setup-api/fiscal-test", async (c) => {
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    fiscalTesting = true;
    return runProvision(c, log, async () => {
      try {
        if (deps.runFiscalTest === undefined) return directError(c, log, "setup.not_ready", 503);
        const parsed = await readRawJsonBody<unknown>(c);
        const payload = await parseProvisionPayload(
          parsed,
          deps.environment,
          deps.devMode === true,
          c.req.header("Accept-Language"),
        );
        if (payload.mode !== "live" || payload.request.environment !== "production") {
          invalidRequest("mode");
        }
        return c.json(
          await deps.runFiscalTest({
            request: payload.request,
            contribution: payload.contribution,
            secret: payload.rawSecret,
          }),
        );
      } finally {
        fiscalTesting = false;
      }
    });
  });

  app.post("/setup-api/provision", async (c) => {
    // Deps gate — before the latch, so an unwired box never engages it. Captured as consts so
    // TypeScript narrows them for the async closure below.
    const provision = deps.provision;
    const recoverProvision = deps.recoverProvision;
    const seedDemo = deps.seedDemo;
    const establishIdentity = deps.establishIdentity;
    const seedMembership = deps.seedMembership;
    const db = deps.db;
    const ring = deps.ring;
    const persistTrading = deps.persistTrading;
    const requestRestart = deps.requestRestart;
    const stateDir = deps.stateDir;
    if (
      provision === undefined ||
      (deps.operations !== undefined && recoverProvision === undefined) ||
      seedDemo === undefined ||
      establishIdentity === undefined ||
      seedMembership === undefined ||
      db === undefined ||
      ring === undefined ||
      persistTrading === undefined ||
      requestRestart === undefined ||
      stateDir === undefined
    ) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // SYNCHRONOUS before ANY `await`, so this check+set completes before a second near-simultaneous
    // POST's handler begins. Reset whenever the request does not end in a success answer (below),
    // so the lock does not refuse a retry; left set after a success answer, which schedules a
    // restart unless it is the replay of a completed operation.
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    const execute = async (
      payload: Awaited<ReturnType<typeof parseProvisionPayload>>,
      rawEmail: unknown,
      rawStaffEmail: unknown,
      operation?: ActiveSetupOperation,
    ): Promise<Response> => {
      if (deps.environment === "production" && payload.mode !== "live") {
        throw new AppError("setup.mode_not_allowed", { environment: "production" });
      }
      if (deps.installationOrigin === "usb" && payload.mode === "demo") {
        throw new AppError("setup.mode_not_allowed", { installationOrigin: "usb" });
      }
      const { mode, request, contribution, secret, secretExpected: expected, rawSecret } = payload;
      if (
        mode === "live" &&
        deps.firstFiscal !== undefined &&
        deps.firstFiscal.offerings(request.venue.fiscalTerritory).length > 0
      )
        throw new AppError("setup.owner_required", {});
      const { environment, venue } = request;
      if (payload.errorReportsEnabled && !deps.initialiseErrorReports)
        throw new AppError("setup.not_ready", {});
      if (rawStaffEmail !== undefined && typeof rawStaffEmail !== "boolean")
        invalidRequest("cloudStaffEmail");
      const staffEmail =
        rawStaffEmail === true &&
        mode === "prepare" &&
        deps.devMode !== true &&
        environment === "preproduction" &&
        !request.configurationImport;
      if (
        (mode === "prepare" || mode === "live") &&
        deps.devMode !== true &&
        !staffEmail &&
        rawEmail === undefined
      ) {
        throw new AppError("setup.email_required", { field: "email" });
      }
      if (mode === "demo" && rawEmail !== undefined) invalidRequest("email");
      const email =
        rawEmail === undefined ? undefined : parseEmailSettings(asObject(rawEmail, "email"));
      if (environment === "production") {
        if (deps.assertFiscalReady === undefined) {
          throw new AppError("setup.fiscal_test_required", { module: contribution.id });
        }
        await deps.assertFiscalReady({ request, contribution, secret: rawSecret });
      }
      let result: VenueResult;
      if (operation !== undefined && operation.phase !== "started") {
        result = operation.data.result as VenueResult;
      } else {
        try {
          result = await provision(request);
          if (request.initialAllocation !== undefined) {
            log("info", "setup.throwaway_allocation", { mode });
          }
        } catch (error) {
          if (
            operation === undefined ||
            recoverProvision === undefined ||
            !isAppError(error) ||
            error.code !== "setup.already_provisioned"
          ) {
            throw error;
          }
          result = await recoverProvision(request);
        }
        await operation?.advance("venue_committed", { result });
      }

      if (!setupPhaseReached(operation, "content_seeded")) {
        if (mode === "demo") {
          await seedDemo(result, { environment, venue });
        }
        await operation?.advance("content_seeded");
      }

      if (!setupPhaseReached(operation, "identity_established")) {
        await establishIdentity(result.nodeId);
        await operation?.advance("identity_established");
      }

      if (!setupPhaseReached(operation, "membership_seeded")) {
        await seedMembership(result.nodeId);
        await operation?.advance("membership_seeded");
      }

      if (!setupPhaseReached(operation, "secret_sealed")) {
        if (expected) await secret!.seal({ db, ring, nodeId: result.nodeId }, rawSecret);
        // The fiscal seat owns its transaction; resume repeats idempotent seals until both finish.
        if (email !== undefined) {
          await withTransaction(db, (tx) => saveSmtpSettings(tx, ring, email, null));
        }
        if (payload.errorReportsEnabled) await deps.initialiseErrorReports!(environment);
        await operation?.advance("secret_sealed");
      }

      let recoveryPackPdf: string | undefined;
      let madeMasterKey: MadeMasterKey | undefined;
      let cloudStaffEmailUnavailable = operation?.data.cloudStaffEmailUnavailable === true;
      if (!setupPhaseReached(operation, "publishing")) {
        const madeAt = new Date();
        const masterKey = makeNewMasterKey(madeAt.toISOString().slice(0, 10));
        const shown = { made: masterKey.made, madeAt: madeAt.toISOString() };
        const packLocale =
          resolveLoginLocale(
            c.req.header("X-Waitron-Recovery-Pack-Locale"),
            venue.admin.locale ?? FALLBACK_LOCALE,
          ) === "es-ES"
            ? "es"
            : "en";
        recoveryPackPdf = await makeMasterKeyRecoveryPack(
          db,
          result.nodeId,
          packLocale,
          log,
          shown,
        );
        const trading: TradingConfig = {
          nodeId: result.nodeId,
          environment,
          ...(deps.devMode === true ? { developmentMode: true } : {}),
          onboardingIntent: mode,
        };
        await persistTrading(trading);
        if (!request.configurationImport) {
          const enabled = await recordSetupCloudPublication(
            c,
            cloudSignIn,
            trading,
            log,
            staffEmail || undefined,
          );
          cloudStaffEmailUnavailable = staffEmail && enabled !== true;
        }
        await deps.clearConfiguration?.();
        await writeBackupKeyOne(stateDir, masterKey);
        // Last venue.db write: a failure before it leaves no master_keys row.
        madeMasterKey = await saveNewMasterKey(db, masterKey, madeAt, null);
        await operation?.advance("publishing", { ...operation.data, cloudStaffEmailUnavailable });
      }

      const publicResult = {
        provisioned: true,
        restarting: true,
        ...labelContactUrl(deps.advertisedOrigin, result.nodeId),
        ...(cloudStaffEmailUnavailable && { cloudStaffEmailUnavailable: true }),
      };
      await operation?.complete(publicResult);
      if (madeMasterKey === undefined) return c.json(publicResult);
      c.header("Cache-Control", "no-store");
      return c.json({
        ...publicResult,
        ...madeMasterKey,
        ...(recoveryPackPdf === undefined ? {} : { recoveryPackPdf }),
      });
    };
    const handle = async (mustRestart: () => void) => {
      let succeeded = false;
      try {
        const requestHash = createHash("sha256").update(await c.req.raw.clone().text());
        const parsed = await readRawJsonBody<unknown>(c);
        const raw = parsed as {
          mode?: unknown;
          venue?: { admin?: { password?: unknown; pin?: unknown } };
        };
        const admin = raw?.venue?.admin;
        const usesHeldAdmin =
          raw?.mode === "prepare" && (admin?.password === "" || admin?.pin === "");
        const prepareBinding =
          raw?.mode === "prepare" && deps.environment === "preproduction"
            ? setupCloudBinding(c, cloudSignIn)
            : undefined;
        const binding = usesHeldAdmin ? prepareBinding : undefined;
        if (
          usesHeldAdmin &&
          !binding &&
          cloudSignIn &&
          deps.environment === "preproduction" &&
          c.req.header("X-Waitron-Setup-Cloud-Tab") !== undefined
        )
          throw new AppError("cloud.request_unavailable", {});
        if (binding) requestHash.update(binding.tab).update(binding.session);
        const hash = requestHash.digest("hex");
        const clearHeldAdmin = async () => {
          if (deps.environment === "preproduction")
            await cloudSignIn?.connection.clearSetupAdmin().catch((error: unknown) => {
              log("warn", "setup.cloud_admin_clear_failed", { errorCode: codeOf(error) });
            });
        };
        const existing = binding ? await deps.operations?.read() : undefined;
        if (
          existing?.kind === "provision" &&
          existing.requestHash === hash &&
          existing.phase === "complete"
        ) {
          await clearHeldAdmin();
          return c.json(existing.data as { provisioned: true; restarting: true });
        }
        const heldAdmin = binding
          ? await cloudSignIn!.connection.readSetupAdmin(binding, existing?.requestHash === hash)
          : undefined;
        const payload = await parseProvisionPayload(
          parsed,
          deps.environment,
          deps.devMode === true,
          c.req.header("Accept-Language"),
          heldAdmin,
        );
        const { email: rawEmail, cloudStaffEmail } = parsed as Record<string, unknown>;
        const recoveryModule =
          payload.mode === "prepare" && deps.environment !== "production"
            ? ALL_MODULES.find((module) => module.fiscal === payload.contribution)
            : undefined;
        if (recoveryModule !== undefined) {
          if (!isSecure(c)) throw new AppError("setup.connection_insecure", {});
          if (!sentFromThisOrigin(c)) throw new AppError("setup.owner_required", {});
        }
        const run = async (operation?: ActiveSetupOperation) => {
          if (operation?.phase === "complete")
            return c.json(operation.data as { provisioned: true; restarting: true });
          const result = await execute(payload, rawEmail, cloudStaffEmail, operation);
          await clearHeldAdmin();
          mustRestart();
          return result;
        };
        const response =
          deps.operations === undefined
            ? await run()
            : await runOperation(c.req.raw, "provision", hash, run);
        succeeded = response.ok;
        return response;
      } finally {
        if (!succeeded) provisioning = false;
      }
    };
    return runProvision(c, log, () => restartAfterReply(c, requestRestart, handle));
  });

  const { holderOf, refuseJoinElsewhere } = mountSetupJoinRoutes(app, deps, log);

  app.post("/setup-api/adopt", async (c) => {
    const adoptJoined = deps.adoptJoined;
    const joinAttempt = deps.joinAttempt;
    const requestRestart = deps.requestRestart;
    if (adoptJoined === undefined || joinAttempt === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }

    // SYNCHRONOUS before ANY `await`, as in provision.
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    const run = async (
      joined: JoinedBox,
      mustRestart: () => void,
      operation?: ActiveSetupOperation,
    ) => {
      await adoptJoined(joined, {
        // Past "started", the store keeps the record, so a different request cannot run over a
        // half-adopted node.
        beforeFirstWrite: async (environment) => {
          // What the next start takes as this box's environment if the join stops after its stamp
          // and WAITRON_ENV is unset (`withUnfinishedJoinEnvironment`).
          await operation?.advance("venue_committed", { environment });
        },
      });
      const contactUrl = labelContactUrl(deps.advertisedOrigin, joined.identity.nodeId);
      mustRestart();
      return c.json({ adopted: true, restarting: true, ...contactUrl }, 200);
    };
    return runAdopt(c, log, () =>
      restartAfterReply(c, requestRestart, async (mustRestart) => {
        let succeeded = false;
        try {
          refuseJoinElsewhere(c);
          if (holderOf(c) === null) throw new AppError("mirror.join_handle_invalid", {});
          const joined = joinAttempt.joined();
          if (joined === null) throw new AppError("setup.request_invalid", { field: "join" });
          const response =
            deps.operations === undefined
              ? await run(joined, mustRestart)
              : await runOperation(
                  c.req.raw,
                  "adopt",
                  JOIN_ADOPT_REQUEST_HASH,
                  async (operation) => {
                    if (operation.phase !== "started") {
                      throw new AppError("setup.adopt_incomplete", {});
                    }
                    const response = await run(joined, mustRestart, operation);
                    if (response.ok) {
                      await operation.complete({ adopted: true, restarting: true });
                    }
                    return response;
                  },
                );
          succeeded = response.ok;
          return response;
        } finally {
          if (!succeeded) provisioning = false;
        }
      }),
    );
  });

  // The wipe happens at the next start, under the venue lock, which refuses a box holding trading
  // settings, a taxpayer or an operational venue (`runStagedReset`).
  app.post("/setup-api/reset-incomplete-adopt", async (c) => {
    const stageReset = deps.stageReset;
    const requestRestart = deps.requestRestart;
    const operations = deps.operations;
    if (stageReset === undefined || requestRestart === undefined || operations === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runReset(c, log, () =>
      restartAfterReply(c, requestRestart, async (mustRestart) => {
        let succeeded = false;
        try {
          refuseJoinElsewhere(c);
          const record = await operations.read();
          if (!isUnfinishedAdopt(record)) {
            throw new AppError("setup.reset_unavailable", {});
          }
          await stageReset(record.id);
          const response = c.json({ resetStaged: true, restarting: true }, 202);
          mustRestart();
          succeeded = true;
          return response;
        } finally {
          if (!succeeded) provisioning = false;
        }
      }),
    );
  });

  mountSetupCloudRecoverySessionRoutes(app, deps, log, setupBusy);
  app.post("/setup-api/cloud-recovery/restore", async (c) => {
    const requestRestart = deps.requestRestart;
    if (!deps.cloudRecovery || !deps.stageRestore || !requestRestart)
      return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging || emailTesting())
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runRestore(c, log, () =>
      restartAfterReply(c, requestRestart, async (mustRestart) => {
        try {
          const body = await readJsonBody<{
            pointId?: unknown;
            oldBoxGone?: unknown;
            recoveryOperation?: unknown;
            nodeRecoverySecret?: unknown;
            recoveryContext?: unknown;
          }>(c);
          if (
            typeof body.pointId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.pointId)
          )
            invalidRequest("pointId");
          if (body.oldBoxGone !== undefined && typeof body.oldBoxGone !== "boolean") {
            invalidRequest("oldBoxGone");
          }
          const credentials = recoveryCredentials(
            deps.recoveryOperationPath,
            body.recoveryOperation,
            body.nodeRecoverySecret,
            body.recoveryContext,
          );
          c.header("Cache-Control", "no-store");
          const pointId = body.pointId;
          const oldBoxGone = body.oldBoxGone === true;
          const binding = await deps.cloudRecovery!.binding();
          if (binding.pointId !== pointId) throw new AppError("setup.operation_conflict", {});
          const execute = async () => {
            await deps.cloudRecovery!.restore(
              (request) => deps.stageRestore!({ ...request, ...credentials }, { oldBoxGone }),
              pointId,
            );
            mustRestart();
            return c.json({ restoreStaged: true, restarting: true }, 202);
          };
          if (!deps.operations) return await execute();
          const requestHash = createHash("sha256")
            .update("cloud-recovery:")
            .update(binding.requestId)
            .update(":")
            .update(pointId)
            .update(oldBoxGone ? ":confirmed" : "")
            .update("\0")
            .update(JSON.stringify(credentials))
            .digest("hex");
          return await runOperation(c.req.raw, "restore", requestHash, async (operation) => {
            if (operation.phase === "complete") {
              mustRestart();
              return c.json({ restoreStaged: true, restarting: true }, 202);
            }
            const response = await execute();
            await operation.complete({ restoreStaged: true, restarting: true });
            return response;
          });
        } catch (error) {
          provisioning = false;
          throw error;
        }
      }),
    );
  });

  app.post("/setup-api/restore-bucket/preview", async (c) => {
    const preview = deps.previewBucketRestore;
    if (preview === undefined) return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging || emailTesting())
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runBucketRestore(c, log, async () => {
      try {
        const body = await readJsonBody<{
          bucket?: unknown;
          masterKey?: unknown;
          environment?: unknown;
          oldBoxGone?: unknown;
        }>(c);
        const source = bucketRestoreSource(body);
        const environment = body.environment;
        if (environment !== "production" && environment !== "preproduction")
          invalidRequest("environment");
        if (body.oldBoxGone !== undefined && typeof body.oldBoxGone !== "boolean")
          invalidRequest("oldBoxGone");
        c.header("Cache-Control", "no-store");
        return c.json(
          await preview(
            { ...source, environment, oldBoxGone: body.oldBoxGone === true },
            c.req.raw.signal,
          ),
          200,
        );
      } finally {
        provisioning = false;
      }
    });
  });
  app.post("/setup-api/cloud-recovery/preview", async (c) => {
    const preview = deps.previewCloudRestore;
    if (preview === undefined) return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging || emailTesting())
      return directError(c, log, "setup.already_provisioning", 409);
    provisioning = true;
    return runRestore(c, log, async () => {
      try {
        const body = await readJsonBody<{ pointId?: unknown }>(c);
        if (
          typeof body.pointId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.pointId)
        )
          invalidRequest("pointId");
        c.header("Cache-Control", "no-store");
        return c.json(await preview(body.pointId), 200);
      } finally {
        provisioning = false;
      }
    });
  });

  app.post("/setup-api/restore", async (c) => {
    const stageRestore = deps.stageRestore;
    const requestRestart = deps.requestRestart;
    if (
      stageRestore === undefined ||
      requestRestart === undefined ||
      deps.receiveArchive === undefined
    ) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runRestore(c, log, () =>
      restartAfterReply(c, requestRestart, async (mustRestart) => {
        let upload: ArchiveUpload | undefined;
        try {
          const type = c.req.header("content-type")?.toLowerCase() ?? "";
          const drive = isJsonRequest(c.req.raw);
          const fieldsInBody = drive || type.startsWith("multipart/form-data");
          if (!fieldsInBody && !type.startsWith("application/octet-stream"))
            invalidRequest("artifact");
          const headerKey = fieldsInBody
            ? undefined
            : asMasterKey(c.req.header("x-waitron-master-key"), "masterKey");
          const headerEnvironment = c.req.header("x-waitron-restore-environment");
          if (
            !fieldsInBody &&
            headerEnvironment !== "production" &&
            headerEnvironment !== "preproduction"
          )
            invalidRequest("environment");
          if (!fieldsInBody && isUnset(deps.recoveryOperationPath))
            invalidRequest("recoveryOperation");
          const readFields = (form: ReadonlyMap<string, string> | undefined) =>
            restoreFields(form, {
              masterKey: headerKey,
              environment: headerEnvironment,
              oldBoxGone: c.req.header("x-waitron-old-box-gone"),
              recoveryOperationPath: deps.recoveryOperationPath,
            });
          let checked: ReturnType<typeof restoreFields> | undefined;
          upload = await deps.receiveArchive!(c.req.raw, {
            fields: [
              "masterKey",
              "environment",
              "oldBoxGone",
              "recoveryOperation",
              "nodeRecoverySecret",
              "recoveryContext",
            ],
            exactFields: drive,
            drive: true,
            moves: true,
            check: (fields) => {
              checked = readFields(fields);
            },
          });
          const { masterKey, rawEnvironment, oldBoxGone, credentials } =
            checked ?? readFields(fieldsInBody ? upload.fields : undefined);
          c.header("Cache-Control", "no-store");
          const hash = createHash("sha256")
            .update(rawEnvironment)
            .update(oldBoxGone ? "\0confirmed\0" : "\0")
            .update(masterKey)
            .update("\0");
          for await (const bytes of createReadStream(upload.artifactPath))
            hash.update(bytes as Buffer);
          const requestHash = hash.update("\0").update(JSON.stringify(credentials)).digest("hex");
          const execute = async (): Promise<Response> => {
            await stageRestore(
              {
                kind: "archive-file",
                artifactPath: upload!.artifactPath,
                signal: c.req.raw.signal,
                recoveryKey: await openingKeyFor(upload!, masterKey),
                environment: rawEnvironment,
                ...credentials,
              },
              { oldBoxGone },
            );
            if (drive) await deps.releaseDrives?.();
            mustRestart();
            // The restore is already recorded, so it must still answer and restart; the next start
            // that reaches the server's boot clears the staging folder.
            await deps.clearStagedRecovery?.().catch(() => {
              log("warn", "setup.staged_recovery_clear_failed", {});
            });
            return c.json({ restoreStaged: true, restarting: true }, 202);
          };
          // Awaited, so a refused staging reaches the catch below and releases the latch.
          if (deps.operations === undefined) return await execute();
          return await runOperation(c.req.raw, "restore", requestHash, async (operation) => {
            if (operation.phase === "complete") {
              return c.json({ restoreStaged: true, restarting: true }, 202);
            }
            const response = await execute();
            await operation.complete({ restoreStaged: true, restarting: true });
            return response;
          });
        } catch (error) {
          provisioning = false;
          throw error;
        } finally {
          await upload?.dispose();
        }
      }),
    );
  });

  app.post("/setup-api/restore-bucket", async (c) => {
    const stage = deps.stageBucketRestore;
    const requestRestart = deps.requestRestart;
    if (stage === undefined || requestRestart === undefined) {
      return directError(c, log, "setup.not_ready", 503);
    }
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    provisioning = true;

    return runBucketRestore(c, log, () =>
      restartAfterReply(c, requestRestart, async (mustRestart) => {
        try {
          const body = await readJsonBody<{
            bucket?: unknown;
            masterKey?: unknown;
            selectedSourceId?: unknown;
            environment?: unknown;
            oldBoxGone?: unknown;
            venueConfirmed?: unknown;
            recoveryOperation?: unknown;
            nodeRecoverySecret?: unknown;
            recoveryContext?: unknown;
          }>(c);
          const source = bucketRestoreSource(body);
          const selectedSourceId = asString(body.selectedSourceId, "selectedSourceId");
          if (Buffer.byteLength(selectedSourceId) > 4096) invalidRequest("selectedSourceId");
          const environment = body.environment;
          if (environment !== "production" && environment !== "preproduction") {
            invalidRequest("environment");
          }
          if (body.oldBoxGone !== undefined && typeof body.oldBoxGone !== "boolean") {
            invalidRequest("oldBoxGone");
          }
          if (body.venueConfirmed !== undefined && typeof body.venueConfirmed !== "string") {
            invalidRequest("venueConfirmed");
          }
          const credentials = recoveryCredentials(
            deps.recoveryOperationPath,
            body.recoveryOperation,
            body.nodeRecoverySecret,
            body.recoveryContext,
          );
          c.header("Cache-Control", "no-store");
          const input: BucketRestoreInput = {
            ...credentials,
            ...source,
            selectedSourceId,
            environment,
            oldBoxGone: body.oldBoxGone === true,
            venueConfirmed: typeof body.venueConfirmed === "string" ? body.venueConfirmed : null,
          };
          const requestHash = createHash("sha256")
            .update(
              JSON.stringify([
                "bucket",
                environment,
                input.oldBoxGone,
                input.venueConfirmed,
                source,
                selectedSourceId,
                credentials,
              ]),
            )
            .digest("hex");
          const execute = async (): Promise<Response> => {
            await stage(input, c.req.raw.signal);
            mustRestart();
            return c.json({ restoreStaged: true, restarting: true }, 202);
          };
          if (deps.operations === undefined) return await execute();
          return await runOperation(c.req.raw, "restore", requestHash, async (operation) => {
            if (operation.phase === "complete") {
              return c.json({ restoreStaged: true, restarting: true }, 202);
            }
            const response = await execute();
            await operation.complete({ restoreStaged: true, restarting: true });
            return response;
          });
        } catch (error) {
          provisioning = false;
          throw error;
        }
      }),
    );
  });

  app.post("/setup-api/configuration", async (c) => {
    const stage = deps.stageConfiguration;
    const receive = deps.receiveArchive;
    if (stage === undefined || receive === undefined)
      return directError(c, log, "setup.not_ready", 503);
    if (provisioning || fiscalTesting || configurationStaging || emailTesting()) {
      return directError(c, log, "setup.already_provisioning", 409);
    }
    configurationStaging = true;
    return runConfiguration(c, log, async () => {
      try {
        if (!c.req.header("content-type")?.toLowerCase().startsWith("application/octet-stream")) {
          invalidRequest("artifact");
        }
        const passphrase = asString(c.req.header("x-waitron-export-passphrase"), "passphrase");
        const upload = await receive(c.req.raw, {
          maxBytes: MAX_CONFIGURATION_UPLOAD_BYTES,
          oversizeIsInvalid: true,
          reserveBytes: 0,
        });
        try {
          return c.json(await stage(upload.artifactPath, passphrase, c.req.raw.signal), 200);
        } finally {
          await upload.dispose();
        }
      } finally {
        configurationStaging = false;
      }
    });
  });
  return { setupBusy };
}
