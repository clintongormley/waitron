import { join } from "node:path";
import { mountSetupSpa } from "./setup-spa.js";
import { isUnset } from "./env-value.js";
import { readModuleConfig } from "./module-config.js";
import { withFirstSetupPublication } from "./first-setup-publication.js";
import { Hono } from "hono";
import { deploymentEnvironmentFor, lockVenueDatabase } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import {
  assertNoLegacyFirstSetupWorkspace,
  canonicalFirstSetupDirectory,
  createFirstSetupBackupWorkspace,
  emptyAbandonedBackupRecovery,
  finishStartAgainDeletion,
  isEmptiedTombstone,
} from "@waitron/provisioning";
import { AppError, sqliteFailureOf } from "@waitron/shared";
import { errnoOf } from "./errno.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import {
  mountFirstSetupResolutionApi,
  mountFirstSetupResolutionFence,
} from "./setup-first-fiscal-api.js";
import type { Logger } from "./logger.js";
import "./errors.js";
import { readBoxPublicCa } from "./box-tls-repair.js";
import {
  firstSetupBackupRecoveryFor,
  resolveFirstSetupBackupEntry,
} from "./first-setup-backup-entry.js";
import { mountFirstSetupBackupApi } from "./setup-first-backup-api.js";
import { startFailureCode } from "./boot-failure.js";

async function needsResolution(host: ReturnType<typeof createFirstSetupModuleHost>) {
  const pair = await host.store.readResumable();
  if (pair === null) return { claimed: false, unresolved: false };
  const inspection = await host.resolution.inspectFirstSetupResolution();
  const unresolved =
    inspection.pair !== "valid" ||
    (pair.publicationComplete
      ? inspection.database !== "occupied"
      : inspection.database !== "no-venue-rows" ||
        [
          "activation-started",
          "committed",
          "publication",
          "complete",
          "uncertain",
          "abandoned",
        ].includes(pair.state.status));
  return { claimed: true, unresolved };
}

export async function resolveFirstSetupEntry(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  requestRestart?: () => void,
  log: Logger = () => {},
) {
  const refused = await refusedAtStart(roots, log);
  if (refused !== undefined) return refused;
  const backup = await resolveFirstSetupBackupEntry(roots);
  if (backup.kind === "repair")
    return {
      kind: "resolution" as const,
      ...(await resolutionApp(backup.roots, environment, requestRestart, log)),
      roots: backup.roots,
    };
  if (backup.kind === "selected") {
    const admission = await resolveLegacyFirstSetupEntry(
      backup.roots,
      environment,
      requestRestart,
      log,
    );
    if (admission.kind === "resolution") return admission;
    return {
      ...admission,
      run: <T>(body: (venueHeld: boolean) => Promise<T>) =>
        backup.run(() => admission.run(() => body(true))),
    };
  }
  return resolveLegacyFirstSetupEntry(roots, environment, requestRestart, log);
}

const START_REFUSALS = ["setup.workspace_unsupported", "setup.start_again_incomplete"] as const;

/** Runs before A731's entry, which would otherwise serve its repair page from a half-deleted attempt. */
async function refusedAtStart(roots: FirstSetupRoots, log: Logger) {
  let canonical: FirstSetupRoots;
  try {
    canonical = {
      venueDir: await canonicalFirstSetupDirectory(roots.venueDir),
      stateDir: await canonicalFirstSetupDirectory(roots.stateDir),
    };
  } catch {
    return undefined;
  }
  await emptyDiscardedRecovery(canonical, log);
  try {
    await assertNoLegacyFirstSetupWorkspace(canonical);
    await finishStartAgainDeletion(canonical);
  } catch (error) {
    if (!(error instanceof AppError)) return undefined;
    const refusal = START_REFUSALS.find((candidate) => candidate === error.code);
    if (refusal !== undefined)
      return { kind: "refused" as const, code: refusal, roots: canonical, error };
  }
  return undefined;
}

/** Finishes a discard a power cut stopped after the abandon; a refusal is logged and the start goes on. */
async function emptyDiscardedRecovery(roots: FirstSetupRoots, log: Logger) {
  let target: string | undefined;
  let path: string | undefined;
  try {
    const last = (await createFirstSetupBackupWorkspace(roots).readChain()).at(-1);
    if (last?.phase !== "abandoned") return;
    const id = last.target.recoveryId;
    target = last.target.target.venueDir;
    path = join(roots.stateDir, "first-setup-resolutions", "backup-recovery", id);
    if (await isEmptiedTombstone(roots, id)) return;
    await emptyAbandonedBackupRecovery(roots, id);
  } catch (error) {
    const errno = errnoOf(error);
    const errcode = sqliteFailureOf(error)?.errcode;
    log("warn", "setup.recovery_cleanup_refused", {
      reason:
        error instanceof AppError
          ? error.code
          : await startFailureCode(error, [
              roots.venueDir,
              ...(target === undefined ? [] : [target]),
            ]),
      ...(errno === undefined ? {} : { errno }),
      ...(errcode === undefined ? {} : { errcode }),
      ...(path === undefined ? {} : { path }),
    });
  }
}

async function resolveLegacyFirstSetupEntry(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  requestRestart?: () => void,
  log: Logger = () => {},
) {
  try {
    roots = {
      venueDir: await canonicalFirstSetupDirectory(roots.venueDir),
      stateDir: await canonicalFirstSetupDirectory(roots.stateDir),
    };
  } catch {
    return {
      kind: "normal" as const,
      roots,
      run: <T>(body: (venueHeld: boolean) => Promise<T>) => body(false),
    };
  }
  try {
    await assertNoLegacyFirstSetupWorkspace(roots);
  } catch {
    return {
      kind: "resolution" as const,
      ...(await resolutionApp(roots, environment, requestRestart, log)),
      roots,
    };
  }
  const host = createFirstSetupModuleHost({ ...roots, environment, modules: ALL_MODULES });
  let claimed = false;
  try {
    const admission = await needsResolution(host);
    claimed = admission.claimed;
    if (admission.unresolved)
      return {
        kind: "resolution" as const,
        ...(await resolutionApp(roots, environment, requestRestart, log)),
        roots,
      };
  } catch {
    return {
      kind: "resolution" as const,
      ...(await resolutionApp(roots, environment, requestRestart, log)),
      roots,
    };
  }
  return {
    kind: "normal" as const,
    roots,
    /** `body` learns whether this process holds the venue folder for the whole call. */
    async run<T>(body: (venueHeld: boolean) => Promise<T>): Promise<T> {
      if (!claimed) return body(false);
      const hold = await lockVenueDatabase(roots.venueDir);
      try {
        await assertNoLegacyFirstSetupWorkspace(roots);
        if ((await needsResolution(host)).unresolved)
          throw new AppError("setup.attempt_uncertain", {});
        return await body(true);
      } finally {
        hold.release();
      }
    },
  };
}

async function resolutionApp(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  requestRestart?: () => void,
  log: Logger = () => {},
) {
  const moduleConfig = await readModuleConfig(roots.stateDir).catch(() => undefined);
  const host = createFirstSetupModuleHost({
    ...roots,
    environment,
    modules: ALL_MODULES,
    moduleConfig,
  });
  const app = new Hono();
  const backup = firstSetupBackupRecoveryFor(roots, environment, host, log);
  mountFirstSetupResolutionFence(app, backup, log);
  mountFirstSetupBackupApi(app, backup, log, requestRestart);
  app.get("/setup-api/status", async (c) => {
    const pair = await host.store.readResumable().catch(() => null);
    const frozenEnvironment = pair?.state.frozen.environment;
    const selectedEnvironment =
      frozenEnvironment ?? deploymentEnvironmentFor(environment.WAITRON_ENV) ?? "preproduction";
    return c.json(
      {
        provisioned: false,
        environment: selectedEnvironment,
        ...(environment.WAITRON_ENV === "dev" && selectedEnvironment === "preproduction"
          ? { developmentMode: true }
          : {}),
        needs: ["first-setup-resolution"],
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });
  app.get("/setup-api/discovery", async (c) =>
    c.json(
      {
        caDownloadAvailable: await readBoxPublicCa(roots.stateDir).then(
          (pem) => pem !== null,
          () => false,
        ),
      },
      200,
      { "Cache-Control": "no-store" },
    ),
  );
  app.get("/setup-api/first-setup/status", (c) =>
    c.json({ claimed: true, resolution: true }, 200, { "Cache-Control": "no-store" }),
  );
  const actions = createFirstSetupResolutionActions({ ...roots, host, backupRecovery: backup });
  mountFirstSetupResolutionApi(app, host, log, {
    startAgain: actions.startAgainFirstSetup,
    summary: actions.startAgainSummary,
    ...(moduleConfig === undefined
      ? {}
      : {
          withPublication: <T>(body: (deps: import("./setup-api.js").SetupDeps) => Promise<T>) =>
            withFirstSetupPublication(roots, environment, host, body),
        }),
    ...(requestRestart === undefined ? {} : { requestRestart }),
  });
  if (!isUnset(environment.WAITRON_SETUP_APP_DIR))
    mountSetupSpa(app, environment.WAITRON_SETUP_APP_DIR!, log);
  return { app, dispose: () => backup.dispose() };
}
