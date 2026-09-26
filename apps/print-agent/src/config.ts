import { isIPv4 } from "node:net";

/** Env wins over the state directory's `config.json`, so the setup page never overrides a
 * compose-supplied address. */
export interface EnvConfig {
  /** The venue server's origin, or undefined when the operator must enter it on the setup page. */
  serverUrl?: string;
  /** The agent's display name; undefined lets the Host fall back to a saved name. */
  name?: string;
  stateDir: string;
  setupPort: number;
  setupUrl?: string;
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

  const rawSetupUrl = value(env.WAITRON_SETUP_URL);
  const rawAddresses = value(env.WAITRON_BOX_ADDRESSES);
  let setupUrl: string | undefined;
  if (rawSetupUrl !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(rawSetupUrl);
    } catch {
      throw new Error("WAITRON_SETUP_URL must be a browser-facing http(s) origin");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      ["localhost", "0.0.0.0", "[::]", "[::1]"].includes(parsed.hostname) ||
      parsed.hostname.startsWith("127.")
    ) {
      throw new Error("WAITRON_SETUP_URL must be a browser-facing http(s) origin");
    }
    setupUrl = parsed.origin;
  } else if (rawAddresses !== undefined) {
    const addresses = rawAddresses.split(",").map((address) => address.trim());
    if (
      addresses.some(
        (address) => !isIPv4(address) || address.startsWith("127.") || address === "0.0.0.0",
      )
    ) {
      throw new Error("WAITRON_BOX_ADDRESSES must contain non-loopback IPv4 addresses");
    }
    setupUrl = new URL(`http://${addresses[0]}:${setupPort}`).origin;
  }

  return {
    serverUrl,
    name: value(env.WAITRON_AGENT_NAME) ?? hostname,
    stateDir: value(env.WAITRON_STATE_DIR) ?? DEFAULT_STATE_DIR,
    setupPort,
    ...(setupUrl === undefined ? {} : { setupUrl }),
  };
}
