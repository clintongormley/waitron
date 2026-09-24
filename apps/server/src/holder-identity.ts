import { join } from "node:path";
import {
  setVenueCrashReportDirectory,
  setVenueHolderKind,
  setVenueWatchdogLogFile,
  type VenueHolderKind,
} from "@waitron/db";
import { applicationVersion } from "./app-version.js";
import { DEFAULT_STATE_ROOT } from "./boot.js";
import { resolveConfigDir } from "./config.js";
import { isUnset } from "./env-value.js";
import { LOG_FILE_NAME } from "./recovery-surface.js";

/**
 * Names this process in the holder file of every venue folder it takes, and points its watchdog
 * at the log directory: the crash report file goes to `<logDir>/crash-reports` (the `logs` volume
 * on a box, which a restore does not touch), and the one-line report is appended to the log file
 * the recovery page tails.
 *
 * The log directory is `config.ts`'s own `logDir` expression, repeated because a process that
 * reaches this may be one whose configuration does not load.
 */
export function nameVenueHolder(kind: VenueHolderKind, env: NodeJS.ProcessEnv): void {
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const logDir = isUnset(env.WAITRON_LOG_DIR) ? join(stateDir, "logs") : env.WAITRON_LOG_DIR;
  setVenueHolderKind(kind);
  setVenueCrashReportDirectory(join(logDir, "crash-reports"), applicationVersion(env));
  setVenueWatchdogLogFile(join(logDir, LOG_FILE_NAME));
}
