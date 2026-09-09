import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig } from "@waitron/print-agent";

/**
 * The container host's on-disk state (base spec §2.2): the setup page's saved `config.json` and the
 * join token. The state directory is a named volume, so both survive a container restart. The token
 * carries a bearer secret, so it is written 0600 and atomically (temp file + rename) — a reader never
 * sees a half-written token, and it is never world-readable.
 */
export class FileState {
  private readonly configPath: string;
  private readonly tokenPath: string;

  constructor(private readonly dir: string) {
    this.configPath = join(dir, "config.json");
    this.tokenPath = join(dir, "token");
  }

  async readConfig(): Promise<AgentConfig | null> {
    let raw: string;
    try {
      raw = await readFile(this.configPath, "utf8");
    } catch {
      return null;
    }
    // A corrupt or partial config reads as null so the setup page simply asks again, rather than
    // crashing the agent on a file the operator can fix from the page.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "serverUrl" in parsed &&
        typeof parsed.serverUrl === "string" &&
        "name" in parsed &&
        typeof parsed.name === "string"
      ) {
        const config: AgentConfig = { serverUrl: parsed.serverUrl, name: parsed.name };
        if ("environment" in parsed && typeof parsed.environment === "string") {
          config.environment = parsed.environment;
        }
        return config;
      }
    } catch {
      return null;
    }
    return null;
  }

  async writeConfig(config: AgentConfig): Promise<void> {
    await this.atomicWrite(this.configPath, JSON.stringify(config), 0o600);
  }

  async readToken(): Promise<string | null> {
    try {
      return (await readFile(this.tokenPath, "utf8")).trimEnd();
    } catch {
      return null;
    }
  }

  /** Persists the bearer token, or clears it when `null`. Clearing an absent token is a no-op. */
  async writeToken(token: string | null): Promise<void> {
    if (token === null) {
      await rm(this.tokenPath, { force: true });
      return;
    }
    await this.atomicWrite(this.tokenPath, token, 0o600);
  }

  private async atomicWrite(path: string, data: string, mode: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, data, { mode });
    await rename(tmp, path);
  }
}
