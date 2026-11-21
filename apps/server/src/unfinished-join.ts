import type { DeploymentEnvironment } from "@waitron/db";
import { resolveConfigDir } from "./config.js";
import { isUnset } from "./env-value.js";
import { createSetupOperationStore } from "./setup-operation.js";

/**
 * `env` with `WAITRON_ENV` set to the main box's environment while a join this box started is past
 * its first write and unfinished, and `WAITRON_ENV` is unset or empty. The setup route records
 * that environment in the operation record from the hook `adoptFromPrimary` calls before its stamp,
 * so such a box starts in setup, where the incomplete join can be reset, rather than refusing its
 * own stamp. `env` unchanged otherwise, including when the record cannot be read.
 */
export async function withUnfinishedJoinEnvironment(
  env: Record<string, string | undefined>,
  defaultStateRoot: string,
): Promise<Record<string, string | undefined>> {
  if (!isUnset(env.WAITRON_ENV)) return env;
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, defaultStateRoot);
  const record = await createSetupOperationStore(stateDir)
    .read()
    .catch(() => null);
  if (
    record === null ||
    record.kind !== "adopt" ||
    record.phase === "started" ||
    record.phase === "complete"
  )
    return env;
  const environment = record.data.environment;
  return environment === "production" || environment === "preproduction"
    ? { ...env, WAITRON_ENV: environment satisfies DeploymentEnvironment }
    : env;
}
