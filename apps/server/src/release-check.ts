import type { DeploymentEnvironment } from "@waitron/db";
import { AppError, type BuiltRelease } from "@waitron/shared";
import "./errors.js";

export function refuseUnreleasedBuild(
  environment: DeploymentEnvironment,
  release: BuiltRelease,
): void {
  if (environment === "production" && release.bundled && release.version === null) {
    throw new AppError("server.unreleased_build", {});
  }
}
