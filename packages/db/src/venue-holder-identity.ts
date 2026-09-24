import { join } from "node:path";
import {
  setVenueCrashReportDirectory,
  setVenueHolderKind,
  setVenueWatchdogLogFile,
  type VenueHolderKind,
} from "@waitron/store";

/** The server's log file under the log directory, which the recovery page tails. */
export const LOG_FILE_NAME = "waitron.log";

/**
 * `WAITRON_LOG_DIR` as given, else `logs` under the state directory; an empty setting is unset.
 * Undefined when there is neither, rather than a path under the working directory.
 */
export function resolveLogDir(env: NodeJS.ProcessEnv, stateDir: string): string;
export function resolveLogDir(
  env: NodeJS.ProcessEnv,
  stateDir: string | undefined,
): string | undefined;
export function resolveLogDir(
  env: NodeJS.ProcessEnv,
  stateDir: string | undefined,
): string | undefined {
  const setting = env.WAITRON_LOG_DIR;
  if (setting !== undefined && setting !== "") return setting;
  return stateDir === undefined ? undefined : join(stateDir, "logs");
}

/** The version this build reports for itself: the image's build id, then the package version. */
export function applicationVersion(env: NodeJS.ProcessEnv): string {
  return env.WAITRON_BUILD_ID ?? env.npm_package_version ?? "development";
}

/**
 * Names this process in the holder file of every venue folder it takes, and points its watchdog at
 * the log directory: one report file per kill under `<logDir>/crash-reports` (the `logs` volume on a
 * box, which a restore does not touch), and the watchdog's line appended to the log file the
 * recovery page tails. With no log directory the watchdog writes its line to stderr alone.
 */
export function setVenueHolderIdentity(
  kind: VenueHolderKind,
  env: NodeJS.ProcessEnv,
  stateDir: string | undefined,
): void {
  const logDir = resolveLogDir(env, stateDir);
  setVenueHolderKind(kind);
  setVenueCrashReportDirectory(
    logDir === undefined ? null : join(logDir, "crash-reports"),
    applicationVersion(env),
  );
  setVenueWatchdogLogFile(logDir === undefined ? null : join(logDir, LOG_FILE_NAME));
}
