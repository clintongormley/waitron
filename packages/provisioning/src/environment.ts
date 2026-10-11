import { AppError } from "@waitron/shared";
import { deploymentEnvironmentFor, type DeploymentEnvironment } from "@waitron/db";
import "./errors.js";

/** The variable `apps/server` boots under, so a venue is stamped for the environment its server
 * will demand. */
const ENVIRONMENT_VARIABLE = "WAITRON_ENV";

/** A stamp cannot be taken back (CLAUDE.md §5), so a value naming no environment is refused. */
export function resolveEnvironment(env: Record<string, string | undefined>): DeploymentEnvironment {
  const raw = env[ENVIRONMENT_VARIABLE];
  const environment = deploymentEnvironmentFor(raw);
  if (environment === null) {
    throw new AppError("provisioning.invalid_environment", {
      variable: ENVIRONMENT_VARIABLE,
      value: String(raw),
    });
  }
  return environment;
}
