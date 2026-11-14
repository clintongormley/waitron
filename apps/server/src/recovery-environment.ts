import type { Logger } from "./logger.js";
import type { Hono } from "hono";
import { readRestoreAdminVerifiers } from "./restore-request.js";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import { lockVenueDatabase } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import {
  connectionPair,
  drizzleNodeSqlite,
  VENUE_FILE,
  NODE_FILE,
  JOURNAL_SUFFIX,
} from "@waitron/store";
import {
  canonicalFirstSetupRoots,
  openImmutableWhenWalEmpty,
  openWalInPlace,
  beginEnvironmentMove,
  resumeEnvironmentMove,
  finishEnvironmentMove,
} from "@waitron/provisioning";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { assertDeploymentMatches } from "./deployment-guard.js";
import { deploymentEnvironment } from "./config.js";
import { loadBoxEnv } from "./box-env.js";
import {
  readRecoveryState,
  writeRecoveryState,
  updateRecoveryState,
  cleared,
} from "./recovery-state.js";
import { withRecoveryLock } from "./recovery-lock.js";
import { movedFolder } from "./recovery-start-again.js";
import {
  mountAdministratorChoice,
  type AdministratorView,
  type AuthorizeAdministrator,
} from "./recovery-administrator.js";

type Roots = { stateDir: string; venueDir: string };

export async function readRecoveryDatabase<T>(
  roots: Roots,
  body: (db: Database) => Promise<T>,
  file: typeof VENUE_FILE | typeof NODE_FILE = VENUE_FILE,
): Promise<T> {
  const path = join(roots.venueDir, file);
  const info = await lstat(path);
  if (!info.isFile()) throw new AppError("setup.not_ready", {});
  if (
    await lstat(`${path}${JOURNAL_SUFFIX}`).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    )
  )
    throw new AppError("setup.not_ready", {});
  const immutable = await openImmutableWhenWalEmpty(path);
  const opened = immutable.kind === "wal" ? await openWalInPlace(path) : immutable;
  if (opened.kind !== "open") throw new AppError("setup.not_ready", {});
  try {
    const db = drizzleNodeSqlite(connectionPair(opened.connection, opened.connection), {
      schema: {},
    });
    // This handle goes only to read seats; the underlying connection refuses every write.
    return await body(db as unknown as Database);
  } finally {
    opened.connection.close();
  }
}

async function mismatch(roots: Roots, baseEnv: NodeJS.ProcessEnv): Promise<AppError | undefined> {
  const environment = deploymentEnvironment(await loadBoxEnv(baseEnv, roots.stateDir));
  try {
    await readRecoveryDatabase(roots, (db) =>
      assertDeploymentMatches(
        db,
        environment,
        ALL_MODULES.flatMap((module) => (module.fiscal === undefined ? [] : [module.fiscal])),
      ),
    );
  } catch (error) {
    if (isAppError(error) && hasCode(error, "deployment.environment_mismatch")) return error;
    throw error;
  }
  return undefined;
}

export interface EnvironmentRecoveryDeps {
  roots: Roots;
  baseEnv: NodeJS.ProcessEnv;
  onFinished: () => Promise<void>;
}

async function clearMove(stateDir: string) {
  await updateRecoveryState(
    { read: readRecoveryState, write: writeRecoveryState, lock: withRecoveryLock },
    stateDir,
    cleared,
  );
  await finishEnvironmentMove(stateDir);
}

export async function resumeEnvironmentRecovery(roots: Roots): Promise<Roots | null> {
  const moved = await resumeEnvironmentMove(roots);
  if (moved === null) return null;
  await clearMove(moved.roots.stateDir);
  return moved.roots;
}

async function chooseEnvironmentMove(
  deps: EnvironmentRecoveryDeps,
  authorize: AuthorizeAdministrator,
) {
  const roots = await canonicalFirstSetupRoots(deps.roots);
  const hold = await lockVenueDatabase(roots.venueDir);
  try {
    if ((await mismatch(roots, deps.baseEnv)) === undefined)
      throw new AppError("setup.not_ready", {});
    const hashes = await readRestoreAdminVerifiers(join(roots.venueDir, VENUE_FILE)).catch(
      () => [],
    );
    await authorize(hashes);
    const result = await beginEnvironmentMove(roots);
    try {
      await clearMove(roots.stateDir);
    } catch {
      throw new AppError("setup.environment_move_unfinished", {});
    }
    return movedFolder(result.setAside);
  } finally {
    hold.release();
  }
}

export type { AdministratorView as EnvironmentView } from "./recovery-administrator.js";

export function mountEnvironmentChoice(
  app: Hono,
  deps: EnvironmentRecoveryDeps,
  render: (view: AdministratorView) => Promise<string>,
  log?: Logger,
) {
  mountAdministratorChoice(
    app,
    {
      path: "/recovery-api/environment/start-again",
      stateDir: deps.roots.stateDir,
      throttleId: "cbb18594-6a29-4a73-a4fd-f9968577e439",
      choose: (authorize) => chooseEnvironmentMove(deps, authorize),
      onFinished: deps.onFinished,
    },
    render,
    log,
  );
}
