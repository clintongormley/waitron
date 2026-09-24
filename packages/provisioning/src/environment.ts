import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "@waitron/db";
import "./errors.js";

/** The variable `apps/server` boots under, so a venue is stamped for the environment its server
 * will demand. */
const ENVIRONMENT_VARIABLE = "WAITRON_ENV";

/**
 * Unset (absent or empty) means `preproduction`, and `production` has to be typed out: a stamp
 * cannot be taken back (CLAUDE.md §5). Anything else but `dev` is refused, never rounded to the
 * nearer word.
 *
 * A deliberate twin of `apps/server/src/config.ts`'s `deploymentEnvironment`: a package cannot
 * import an app. Nothing runs both over one input; only their two test tables keep them in step.
 */
export function resolveEnvironment(env: Record<string, string | undefined>): DeploymentEnvironment {
  const raw = env[ENVIRONMENT_VARIABLE];
  if (raw === undefined || raw === "") return "preproduction";
  if (raw === "dev") return "preproduction";
  if (raw !== "production" && raw !== "preproduction") {
    throw new AppError("provisioning.invalid_environment", {
      variable: ENVIRONMENT_VARIABLE,
      value: raw,
    });
  }
  return raw;
}
