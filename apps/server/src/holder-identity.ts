import { setVenueHolderIdentity, type VenueHolderKind } from "@waitron/db";
import { DEFAULT_STATE_ROOT } from "./boot.js";
import { resolveConfigDir } from "./config.js";

/**
 * `setVenueHolderIdentity` with the server's own state directory default, for the programs built
 * from this package. It reads the environment rather than the configuration, because a process
 * that reaches this may be one whose configuration does not load.
 */
export function nameVenueHolder(kind: VenueHolderKind, env: NodeJS.ProcessEnv): void {
  setVenueHolderIdentity(kind, env, resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT));
}
