import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Agent } from "undici";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { freePorts } from "./testing/free-ports.js";

it("serves the built wizard without the retired offline tool or an identity claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-tool-boot-"));
  let server: StartedServer | undefined;
  let agent: Agent | undefined;
  try {
    const repository = resolve(import.meta.dirname, "../../..");
    await promisify(execFile)("pnpm", ["--filter", "@waitron/setup", "build"], {
      cwd: repository,
      timeout: 60_000,
    });
    const wizard = join(repository, "apps/setup/dist");
    await expect(readFile(join(wizard, "setup-assets/custodian-tool.html"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const migrations = join(root, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(
        migrationOptionsFor(manifestSets(), null)[index]!.migrationsFolder,
        join(migrations, set.name),
        { recursive: true },
      );
    }
    const [port] = await freePorts(1);
    const stateDir = join(root, "state");
    server = await startServer({
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: join(root, "venue"),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MIGRATIONS_DIR: migrations,
      WAITRON_SETUP_APP_DIR: wizard,
      WAITRON_ENV: "preproduction",
    });
    agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
    const via = { dispatcher: agent } as RequestInit;
    const response = await fetch(`https://127.0.0.1:${port}/setup-assets/custodian-tool.html`, via);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    const status = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/status`, via);
    expect(await status.json()).toEqual({ claimed: false });
    const index = await fetch(`https://127.0.0.1:${port}/`, via);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("/assets/");
  } finally {
    await agent?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
