import { readDeploymentEnvironment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import "./errors.js";

/**
 * Refuses to proceed when this database belongs to a different environment than this host.
 *
 * Runs BEFORE `applyMigrations`: a staging host pointed at the production database must die before it
 * writes anything. An UNSTAMPED database passes; the record-level `entorno` guard in `drain` still
 * covers it.
 */
export async function assertDeploymentMatches(
  db: Database,
  hostEnvironment: DeploymentEnvironment,
): Promise<void> {
  const stamped = await readDeploymentEnvironment(db);
  if (stamped === null || stamped === hostEnvironment) return;
  throw new AppError("deployment.environment_mismatch", {
    databaseEnvironment: stamped,
    hostEnvironment,
  });
}
