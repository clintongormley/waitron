import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig } from "@waitron/print-agent";

/** The token is a bearer secret, so it is written 0600 and atomically. */
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
    // A corrupt config reads as null, so the setup page asks again rather than the agent crashing.
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
        if (
          "pendingVerificationNumber" in parsed &&
          typeof parsed.pendingVerificationNumber === "string"
        ) {
          config.pendingVerificationNumber = parsed.pendingVerificationNumber;
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

  async writeToken(token: string | null): Promise<void> {
    if (token === null) {
      await rm(this.tokenPath, { force: true });
      return;
    }
    await this.atomicWrite(this.tokenPath, token, 0o600);
  }

  private async atomicWrite(path: string, data: string, mode: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // A per-write temp name, so concurrent writers (the loop and the setup page) never race on one
    // temp file's rename.
    const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data, { mode });
    await rename(tmp, path);
  }
}
