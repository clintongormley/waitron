import type { ServerResponse } from "node:http";
import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { verifyPassword } from "@waitron/identity";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import { lockVenueDatabase } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { connectionPair, drizzleNodeSqlite, VENUE_FILE } from "@waitron/store";
import {
  canonicalFirstSetupRoots,
  openImmutableWhenWalEmpty,
  openWalInPlace,
  beginEnvironmentMove,
  resumeEnvironmentMove,
  finishEnvironmentMove,
  beginStartAgainGuess,
} from "@waitron/provisioning";
import {
  AppError,
  hasCode,
  isAppError,
  FALLBACK_LOCALE,
  type SupportedLocale,
} from "@waitron/shared";
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
import {
  isSecure,
  formBody,
  afterResponse,
  movedFolder,
  type StartAgainMessage,
} from "./recovery-start-again.js";
import { resolveLoginLocale } from "./login-locale.js";
import { sentFromThisOrigin } from "./own-page.js";

type Roots = { stateDir: string; venueDir: string };

async function readDatabase<T>(roots: Roots, body: (db: Database) => Promise<T>): Promise<T> {
  const path = join(roots.venueDir, VENUE_FILE);
  const info = await lstat(path);
  if (!info.isFile()) throw new AppError("setup.not_ready", {});
  if (
    await lstat(`${path}-journal`).then(
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
    await readDatabase(roots, (db) =>
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

async function chooseEnvironmentMove(deps: EnvironmentRecoveryDeps, password: string) {
  const roots = await canonicalFirstSetupRoots(deps.roots);
  const hold = await lockVenueDatabase(roots.venueDir);
  try {
    if ((await mismatch(roots, deps.baseEnv)) === undefined)
      throw new AppError("setup.not_ready", {});
    const finish = await beginStartAgainGuess(
      roots.stateDir,
      "cbb18594-6a29-4a73-a4fd-f9968577e439",
      new Date(),
    );
    let verified = false;
    try {
      verified = await readDatabase(roots, async (db) => {
        const result = await db.execute<{ password_hash: string | null }>(
          sql`select password_hash from persons where role = 'admin' and status = 'active'`,
        );
        for (const row of result.rows)
          if (row.password_hash !== null && (await verifyPassword(password, row.password_hash)))
            return true;
        return false;
      });
    } catch {
      verified = false;
    }
    if (!verified) throw new AppError("setup.owner_required", {});
    await finish("success");
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

export type EnvironmentView = {
  locale: SupportedLocale;
  secure: boolean;
  message?: StartAgainMessage;
  stopped?: boolean;
  unfinished?: boolean;
};

export function mountEnvironmentChoice(
  app: Hono,
  deps: EnvironmentRecoveryDeps,
  render: (view: EnvironmentView) => Promise<string>,
) {
  let completed = false;
  let unfinished = false;
  app.post("/recovery-api/environment/start-again", async (c) => {
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    const secure = isSecure(c);
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    const answer = async (
      status: 200 | 400 | 403 | 409 | 429,
      message?: StartAgainMessage,
      stopped?: boolean,
    ) =>
      c.html(
        await render({
          locale,
          secure,
          ...(message === undefined ? {} : { message }),
          ...(stopped ? { stopped } : {}),
          ...(unfinished ? { unfinished } : {}),
        }),
        status,
      );
    if (completed || unfinished) return answer(409, { kind: "notFinished" });
    if (!secure) return answer(403, { kind: "insecure" });
    if (!sentFromThisOrigin(c)) return answer(403, { kind: "otherPage" });
    try {
      const form = new URLSearchParams(await formBody(c));
      if (
        [...form.keys()].some((key) => !["password", "choice"].includes(key)) ||
        [...form.keys()].length !== new Set(form.keys()).size
      )
        return answer(400, { kind: "choiceMissing" });
      const choice = form.get("choice");
      if (choice === "keep") return answer(200, undefined, true);
      if (choice !== "move") return answer(400, { kind: "choiceMissing" });
      const password = form.get("password");
      if (password === null || password === "") return answer(400, { kind: "passwordMissing" });
      const folder = await chooseEnvironmentMove(deps, password);
      completed = true;
      const result = await answer(200, { kind: "moved", folder });
      const outgoing = (c.env as { outgoing?: ServerResponse } | undefined)?.outgoing;
      afterResponse(outgoing, () => void deps.onFinished());
      return result;
    } catch (error) {
      if (isAppError(error) && hasCode(error, "password.throttled")) {
        c.header("Retry-After", String(error.params.retryAfterSeconds));
        return answer(429, {
          kind: "throttled",
          minutes: Math.ceil(error.params.retryAfterSeconds / 60),
        });
      }
      if (isAppError(error) && hasCode(error, "setup.owner_required"))
        return answer(403, { kind: "wrongPassword" });
      if (isAppError(error) && hasCode(error, "setup.not_ready"))
        return answer(409, { kind: "notOffered" });
      if (isAppError(error) && hasCode(error, "setup.environment_move_unfinished"))
        unfinished = true;
      return answer(409, { kind: "notFinished" });
    }
  });
}
