/** Env wins over the state directory's `config.json`, so the setup page never overrides a
 * compose-supplied address. */
export interface EnvConfig {
  /** The venue server's origin, or undefined when the operator must enter it on the setup page. */
  serverUrl?: string;
  /** The agent's display name; undefined lets the Host fall back to a saved name. */
  name?: string;
  stateDir: string;
  setupPort: number;
}

export const DEFAULT_STATE_DIR = "/var/lib/waitron-print-agent";
export const DEFAULT_SETUP_PORT = 9110;

/** An env var set to `""` falls back exactly as an unset one does (CLAUDE.md §3). */
function value(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function readEnv(env: NodeJS.ProcessEnv, hostname: string): EnvConfig {
  const rawUrl = value(env.WAITRON_SERVER_URL);
  let serverUrl: string | undefined;
  if (rawUrl !== undefined) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(rawUrl);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      throw new Error(`WAITRON_SERVER_URL is not an http(s) origin: ${rawUrl}`);
    }
    serverUrl = parsed.origin;
  }

  const rawPort = value(env.WAITRON_SETUP_PORT);
  let setupPort = DEFAULT_SETUP_PORT;
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`WAITRON_SETUP_PORT must be an integer in 1..65535: ${rawPort}`);
    }
    setupPort = parsed;
  }

  return {
    serverUrl,
    name: value(env.WAITRON_AGENT_NAME) ?? hostname,
    stateDir: value(env.WAITRON_STATE_DIR) ?? DEFAULT_STATE_DIR,
    setupPort,
  };
}
