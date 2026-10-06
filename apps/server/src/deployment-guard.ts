import { readDeploymentEnvironment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { FiscalContribution } from "@waitron/fiscal";
import type { DeploymentEnvironment } from "./config.js";
import "./errors.js";

export async function assertDeploymentMatches(
  db: Database,
  hostEnvironment: DeploymentEnvironment,
  fiscalContributions: readonly FiscalContribution[] = [],
): Promise<void> {
  const stamped = await readDeploymentEnvironment(db);
  if (stamped === null) {
    if (hostEnvironment === "production") {
      for (const contribution of fiscalContributions) {
        if (await contribution.hasNonproductionRecords?.(db)) {
          throw new AppError("deployment.environment_mismatch", {
            databaseEnvironment: "nonproduction",
            hostEnvironment,
          });
        }
      }
    }
    return;
  }
  if (stamped === hostEnvironment) return;
  throw new AppError("deployment.environment_mismatch", {
    databaseEnvironment: stamped,
    hostEnvironment,
  });
}
