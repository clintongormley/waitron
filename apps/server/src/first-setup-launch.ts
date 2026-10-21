import { Hono } from "hono";
import { join } from "node:path";
import { DEFAULT_STATE_ROOT, startServer } from "./boot.js";
import { DEFAULT_HTTP_HOST, resolveConfigDir } from "./config.js";
import { loadBoxEnv } from "./box-env.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import {
  httpPortFrom,
  landingConfigFrom,
  needsConnectionBootstrap,
  serveRecovery,
  type RecoveryServeOptions,
} from "./recovery-listener.js";
import { closeListener } from "./close-listener.js";

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
  let active: { close(): Promise<void> };
  let closed = false;
  let transition: Promise<void> | undefined;
  let lastOptions: RecoveryServeOptions;
  const listen = async (app: Hono, options: RecoveryServeOptions) => {
    if (seams.serveResolution !== undefined) return seams.serveResolution(app, options);
    const listener = await serveRecovery(app, options);
    return { close: () => closeListener(listener) };
  };
  const onRepaired = async () => {
    if (closed) return;
    if (seams.requestRestart !== undefined) {
      seams.requestRestart();
      return;
    }
    if (transition !== undefined) return transition;
    transition = (async () => {
      await active.close();
      if (closed) return;
      try {
        active = await launch();
      } catch {
        active = await listen(new Hono(), { ...lastOptions, bootstrapOnly: true });
        throw new Error("Connection continuation failed");
      }
    })();
    try {
      await transition;
    } finally {
      transition = undefined;
    }
  };
  const launch = async (): Promise<{ close(): Promise<void> }> => {
    const admission = await resolveFirstSetupEntry(
      { stateDir, venueDir },
      env,
      seams.requestRestart ?? (() => process.kill(process.pid, "SIGTERM")),
      log,
    );
    const effectiveEnv = await loadBoxEnv(env, admission.roots.stateDir);
    const port = httpPortFrom(effectiveEnv);
    const options: RecoveryServeOptions = {
      stateDir: admission.roots.stateDir,
      port,
      log,
      httpHost: isUnset(effectiveEnv.WAITRON_HTTP_HOST)
        ? DEFAULT_HTTP_HOST
        : effectiveEnv.WAITRON_HTTP_HOST,
      landing: landingConfigFrom(effectiveEnv, admission.roots.stateDir, port),
      onRepaired,
      operatorTls:
        !isUnset(effectiveEnv.WAITRON_TLS_CERT_FILE) || !isUnset(effectiveEnv.WAITRON_TLS_KEY_FILE),
    };
    lastOptions = options;
    if (await needsConnectionBootstrap(options, effectiveEnv))
      return listen(new Hono(), { ...options, bootstrapOnly: true });
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
    return listen(admission.app, options);
  };
  active = await launch();
  return {
    close: async () => {
      closed = true;
      await transition?.catch(() => {});
      await active.close();
    },
  };
}
