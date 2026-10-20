import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import type { ModuleOperationHost } from "@waitron/module";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { MODULE, request } from "../test/first-fiscal.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "first-hour-preparation-"));
  roots.push(root);
  let preparation!: ModuleOperationHost;
  const modules = ALL_MODULES.map((module) => {
    if (module.name !== MODULE) return module;
    const initialSetup = module.provisioning!.initialSetup!;
    return {
      ...module,
      provisioning: {
        ...module.provisioning!,
        initialSetup: {
          ...initialSetup,
          configure(host: ModuleOperationHost) {
            preparation = host;
            return initialSetup.configure!(host);
          },
        },
      },
    };
  });
  const stateDir = join(root, "state");
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir: join(root, "venue"),
    environment: {},
    modules,
  });
  await host.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const state = (await host.store.read())!;
  const binding = firstSetupModuleContext(state, MODULE).binding;
  return { host, preparation, binding, stateDir };
}

it("a held preparation read can finish after its callback starts activation", async () => {
  const f = await fixture();
  await expect(
    f.host.coordinator.run(async (hold) => {
      let state = (await f.host.store.read())!;
      state = await f.host.store.update(
        state.frozen.attemptId,
        state.revision,
        { kind: "consumption-intent" },
        hold,
      );
      return f.preparation.withPreparationState!(f.binding, async (store) => {
        expect(store.value).toBeNull();
        await f.host.store.update(
          state.frozen.attemptId,
          state.revision,
          { kind: "activation-started" },
          hold,
        );
        return "activated-callback-result";
      });
    }),
  ).resolves.toBe("activated-callback-result");
  expect((await f.host.store.read())!.status).toBe("activation-started");
});

it("activation-started cannot gain a new preparation revision even with a host write callback", async () => {
  const f = await fixture();
  await expect(
    f.host.coordinator.run(async (hold) => {
      let state = (await f.host.store.read())!;
      state = await f.host.store.update(
        state.frozen.attemptId,
        state.revision,
        { kind: "consumption-intent" },
        hold,
      );
      await f.host.withPreparationAuthorization(
        async () => {},
        () =>
          f.preparation.withPreparationState!(f.binding, async (store) => {
            await f.host.store.update(
              state.frozen.attemptId,
              state.revision,
              { kind: "activation-started" },
              hold,
            );
            await store.replace({ spent: "06RB" });
          }),
      );
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(readFile(join(f.stateDir, "module-preparation-state.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
