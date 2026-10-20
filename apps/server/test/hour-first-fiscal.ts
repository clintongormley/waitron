import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Database } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import type { ModuleConfig, WaitronModule } from "@waitron/module";
import { createFirstSetupModuleHost } from "../src/module-operation-host.js";
import { firstSetupModuleContext } from "../src/first-fiscal-evidence.js";
import { mountSetup } from "../src/setup-api.js";
import { ownedHourSetup } from "./owned-hour-setup.js";
import { request, PASSWORD, MODULE } from "./first-fiscal.js";

export async function hourFirstFiscalFixture(options: {
  database: () => Database;
  environment?: "production" | "preproduction";
  modules?: readonly WaitronModule[];
  moduleConfig?: ModuleConfig;
  workspace?: { root: string; stateDir: string; venueDir: string };
}) {
  const root = options.workspace?.root ?? (await mkdtemp(join(tmpdir(), "hour-first-fiscal-")));
  try {
    const stateDir = options.workspace?.stateDir ?? join(root, "state"),
      venueDir = options.workspace?.venueDir ?? join(root, "venue");
    const modules =
      options.modules ??
      ALL_MODULES.filter((module) => ["core", MODULE, "fiscal-none"].includes(module.name));
    const host = createFirstSetupModuleHost({
      ...options,
      stateDir,
      venueDir,
      modules,
      environment: {},
    });
    const app = new Hono();
    mountSetup(
      app,
      { environment: options.environment ?? "production", firstFiscal: host },
      () => {},
    );
    const owned = await ownedHourSetup(
      async (input, init) => app.request(String(input), init),
      "https://box.test",
      request,
      PASSWORD,
    );
    const state = (await host.store.read())!;
    const ownerAttempt = {
      attemptId: owned.state.attemptId,
      revision: owned.state.revision,
      ownerGeneration: owned.state.ownerGeneration,
      capability: owned.headers["X-Waitron-Setup-Owner"]!,
    };
    return {
      root,
      stateDir,
      venueDir,
      modules,
      ...(options.moduleConfig === undefined ? {} : { moduleConfig: options.moduleConfig }),
      host,
      store: host.store,
      ownerAttempt,
      context: firstSetupModuleContext(state, MODULE),
      input: state.inputs[MODULE],
      password: PASSWORD,
      module: MODULE,
      staged: { ...owned.recovery, stage: await host.keys.readStage(ownerAttempt) },
      dispose: async () => {
        if (options.workspace === undefined) await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (options.workspace === undefined) await rm(root, { recursive: true, force: true });
    throw error;
  }
}
