import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ALL_MODULES } from "@waitron/composition";
import { expect, it } from "vitest";
import { Agent } from "undici";
import { request } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { childProcess, entryWorkspaces, ready } from "../test/first-fiscal-hour-entry.js";
import { useBuiltServer } from "./testing/built-server.js";

const fixture = entryWorkspaces();
const built = useBuiltServer(["src/bin.ts", "src/node-entry.ts"]);

it.each(["src/bin.ts", "src/node-entry.ts"])(
  "%s serves only the repair page over its retained trusted HTTPS without creating the missing database",
  async (script) => {
    const f = await fixture();
    const host = createFirstSetupModuleHost({ ...f, modules: ALL_MODULES, environment: f.env });
    await host.owner.claimFirstSetup({ environment: "preproduction", request });
    const frozen = (await host.store.read())!.frozen;
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const ca = await readFile(join(f.stateDir, "tls", "ca.crt"));
    const agent = new Agent({ connect: { ca } });
    const child = await childProcess(built(script), { ...f.env, WAITRON_ENV: "production" });
    try {
      const origin = `https://127.0.0.1:${child.port}`;
      expect(await ready(child, origin, agent)).toEqual({ claimed: true, resolution: true });
      const get = (path: string) => fetch(`${origin}${path}`, { dispatcher: agent } as RequestInit);
      expect(await (await get("/setup-api/status")).json()).toEqual({
        provisioned: false,
        environment: "preproduction",
        needs: ["first-setup-resolution"],
      });
      expect(await (await get("/setup-api/discovery")).json()).toEqual({
        caDownloadAvailable: true,
      });
      expect((await host.store.read())!.frozen).toEqual(frozen);
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(f.stateDir, "tls", "ca.crt"))).toEqual(ca);
    } finally {
      await child.stop();
      await agent.close();
    }
  },
);

it.each(["src/bin.ts", "src/node-entry.ts"])(
  "%s boots a fresh workspace and keeps its trusted setup listener available after restart",
  async (script) => {
    const f = await fixture();
    let child: Awaited<ReturnType<typeof childProcess>> | undefined;
    let agent: Agent | undefined;
    try {
      child = await childProcess(built(script), f.env);
      await expect
        .poll(async () => readFile(join(f.stateDir, "tls", "ca.crt")), {
          timeout: 45_000,
        })
        .toBeDefined();
      const ca = await readFile(join(f.stateDir, "tls", "ca.crt"));
      agent = new Agent({ connect: { ca } });
      expect(await ready(child, `https://127.0.0.1:${child.port}`, agent)).toEqual({
        claimed: false,
      });
      expect((await stat(join(f.venueDir, "venue.db"))).size).toBeGreaterThan(0);
      await child.stop();
      child = await childProcess(built(script), f.env);
      expect(await ready(child, `https://127.0.0.1:${child.port}`, agent)).toEqual({
        claimed: false,
      });
      expect(await readFile(join(f.stateDir, "tls", "ca.crt"))).toEqual(ca);
    } finally {
      await child?.stop();
      await agent?.close();
    }
  },
  180_000,
);
