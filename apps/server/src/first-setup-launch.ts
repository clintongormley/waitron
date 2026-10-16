import type { Hono } from "hono";
import { join } from "node:path";
import { DEFAULT_STATE_ROOT, startServer } from "./boot.js";
import { DEFAULT_HTTP_HOST, resolveConfigDir } from "./config.js";
import { loadBoxEnv } from "./box-env.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { httpPortFrom, serveRecovery, type RecoveryServeOptions } from "./recovery-listener.js";

export async function startServerOrFirstSetupResolution(
  env: NodeJS.ProcessEnv,
  base: NodeJS.ProcessEnv = {},
  seams: {
    startServer?: (
      env: NodeJS.ProcessEnv,
      base: NodeJS.ProcessEnv,
    ) => Promise<{ close(): Promise<void> }>;
    serveResolution?: (
      app: Hono,
      options: RecoveryServeOptions,
    ) => Promise<{ close(): Promise<void> }>;
    requestRestart?: () => void;
  } = {},
): Promise<{ close(): Promise<void> }> {
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const venueDir = resolveConfigDir(env.WAITRON_VENUE_DIR, join(stateDir, "venue"));
  const log = createLogger(
    (line) => process.stdout.write(line),
    () => new Date(),
  );
  const admission = await resolveFirstSetupEntry(
    { stateDir, venueDir },
    env,
    seams.requestRestart ?? (() => process.kill(process.pid, "SIGTERM")),
    log,
  );
  if (admission.kind === "normal")
    return admission.run(async () => {
      if (admission.roots.binding === null) return (seams.startServer ?? startServer)(env, base);
      const selectedBase = {
        ...env,
        WAITRON_STATE_DIR: admission.roots.stateDir,
        WAITRON_VENUE_DIR: admission.roots.venueDir,
      };
      const selectedEnv = await loadBoxEnv(selectedBase, admission.roots.stateDir);
      return (seams.startServer ?? startServer)(selectedEnv, selectedBase);
    });
  const port = httpPortFrom(env);
  if (seams.serveResolution !== undefined)
    return seams.serveResolution(admission.app, {
      stateDir: admission.roots.stateDir,
      port,
      log,
      httpHost: isUnset(env.WAITRON_HTTP_HOST) ? DEFAULT_HTTP_HOST : env.WAITRON_HTTP_HOST,
    });
  const listener = await serveRecovery(admission.app, {
    stateDir: admission.roots.stateDir,
    port,
    log,
    httpHost: isUnset(env.WAITRON_HTTP_HOST) ? DEFAULT_HTTP_HOST : env.WAITRON_HTTP_HOST,
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
