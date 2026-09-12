import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_SERVER_STATE = fileURLToPath(new URL("../../server/src/state", import.meta.url));

export function serverIsListening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (ready: boolean): void => {
      socket.destroy();
      done(ready);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1_000, () => finish(false));
  });
}

export async function waitForDevServer(port = 8080, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await serverIsListening(port))) {
    if (Date.now() >= deadline) throw new Error(`Dev server did not listen on port ${port}`);
    await sleep(500);
  }
}

/** wa-wt supplies the BOX state to all apps. Nest agent state so target resets clear its token too. */
export async function prepareDevEnv(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const boxState = resolve(env.WAITRON_STATE_DIR?.trim() || DEFAULT_SERVER_STATE);
  const stateDir = join(boxState, "print-agent");
  const configuredUrl = env.WAITRON_SERVER_URL?.trim();
  if (configuredUrl) return { ...env, WAITRON_STATE_DIR: stateDir };

  const tlsDir = join(boxState, "tls");
  const hasLeaf = existsSync(join(tlsDir, "server.crt")) && existsSync(join(tlsDir, "server.key"));
  if (hasLeaf) {
    // The local CA is available even when the unprivileged dev server cannot bind port 80.
    await mkdir(stateDir, { recursive: true });
    await copyFile(join(tlsDir, "ca.crt"), join(stateDir, "server-ca.crt"));
  }
  return {
    ...env,
    WAITRON_STATE_DIR: stateDir,
    WAITRON_SERVER_URL: `${hasLeaf ? "https" : "http"}://127.0.0.1:8080`,
  };
}
