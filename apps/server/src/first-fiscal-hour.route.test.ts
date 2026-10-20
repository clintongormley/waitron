import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type InitialSetupContext,
} from "@waitron/module";
import { createHourSelection } from "@waitron/fiscal-verifactu/src/hour-selection.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { AppError } from "@waitron/shared";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(withStore = false) {
  let captured!: ModuleOperationHost;
  const root = await mkdtemp(join(tmpdir(), "first-hour-route-"));
  roots.push(root);
  const modules = ALL_MODULES.map((module) =>
    module.name !== MODULE
      ? module
      : {
          ...module,
          provisioning: {
            ...module.provisioning!,
            initialSetup: {
              ...module.provisioning!.initialSetup!,
              configure: (bound: ModuleOperationHost) => {
                captured = bound;
                return {
                  ...module.provisioning!.initialSetup!,
                  assignmentKeys: undefined,
                  assignmentPositions: undefined,
                  retainedAssignments: undefined,
                  async candidates(context: InitialSetupContext) {
                    if (!withStore) return { ready: true };
                    const engine = createHourSelection({
                      withState: bound.withPreparationState!,
                      monotonicNow: () => 0,
                      read: async () => ({
                        scope: { taxpayerNif: context.taxId, environment: context.environment },
                        bases: context.bases,
                        contextKey: "owned-hour-test",
                        history: [{ reference: "empty-venue", complete: true, records: [] }],
                        clock: compareHourClocks(
                          ["box", "browser"].map((source) => ({
                            source: source as "box" | "browser",
                            result: "usable" as const,
                            instantMs: Date.parse("2026-10-16T11:40:00Z"),
                            uncertaintyMs: 0,
                            wallStartedMs: 0,
                            wallFinishedMs: 0,
                            monotonicStartedMs: 0,
                            monotonicFinishedMs: 0,
                          })),
                          Date.parse("2026-10-15T00:00:00Z"),
                        ),
                      }),
                    });
                    const selection = await withOperationAuthority(
                      context.binding,
                      context.administratorId,
                      (authority) =>
                        engine.select({ binding: context.binding, authority, answer: "no" }),
                    );
                    return { ready: true, selection };
                  },
                  request(_context: unknown, value: unknown) {
                    if (typeof value !== "object" || value === null || !("ready" in value))
                      throw new AppError("setup.request_invalid", { field: "proposal" });
                    return value;
                  },
                };
              },
              assignmentKeys: undefined,
              assignmentPositions: undefined,
              retainedAssignments: undefined,
              async candidates() {
                return { ready: true };
              },
              request(_context: unknown, value: unknown) {
                if (typeof value !== "object" || value === null || !("ready" in value))
                  throw new AppError("setup.request_invalid", { field: "proposal" });
                return value;
              },
            },
          },
        },
  );
  const options = {
    environment: {},
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules,
  };
  const host = createFirstSetupModuleHost(options);
  const app = new Hono();
  mountSetup(app, { environment: "preproduction", firstFiscal: host }, () => {});
  const claim = await host.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  const post = async (reconfirmation?: string) =>
    app.request("/setup-api/first-setup/candidates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": owner.capability,
        "X-Waitron-Setup-Attempt": owner.attemptId,
        "X-Waitron-Setup-Revision": String(owner.revision),
        "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
      },
      body: JSON.stringify({
        module: MODULE,
        proposal: {},
        reconfirmation:
          reconfirmation ?? (await host.owner.reconfirm(owner, PASSWORD, "block-use")),
      }),
    });
  return {
    root,
    options,
    host,
    app,
    owner,
    post,
    get moduleHost() {
      return captured;
    },
  };
}
it("awaits a module's asynchronous candidate preparation before freezing and exporting it", async () => {
  const f = await fixture();
  const response = await f.post();
  expect(response.status).toBe(200);
  expect(
    (await f.host.store.read())!.frozen.modules.find((entry) => entry.module === MODULE)!.request,
  ).toEqual({ ready: true });
});

it("real candidate routing reuses the shared hold and persists an owned hour before returning", async () => {
  const f = await fixture(true);
  const response = await f.post();
  expect(response.status).toBe(200);
  const state = (await f.host.store.read())!;
  const selected = state.frozen.modules.find((entry) => entry.module === MODULE)!.request as {
    selection: { identity: string; binding: unknown };
  };
  expect(selected.selection.identity).toBe("06RB");
  const ledger = JSON.parse(
    await readFile(join(f.options.stateDir, "module-preparation-state.json"), "utf8"),
  );
  expect(ledger.revisions).toHaveLength(1);
  expect(ledger.revisions[0].binding).toEqual(selected.selection.binding);
  expect(ledger.revisions[0].value.entries[0].identity).toBe("06RB");
}, 5000);
it("the real host refuses foreign preparation bindings under the shared lock", async () => {
  const f = await fixture(true);
  const state = (await f.host.store.read())!;
  const event = state.frozen.modules.find((entry) => entry.module === MODULE)!;
  await expect(
    f.moduleHost.withPreparationState!(
      {
        module: MODULE,
        action: "setup",
        eventId: event.eventId,
        sourceId: state.frozen.sourceId,
        targetNodeId: "foreign",
      },
      async (store) => store.replace({ identity: "06RB" }),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(
    readFile(join(f.options.stateDir, "module-preparation-state.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("an invalid password reconfirmation cannot spend an hour through asynchronous preparation", async () => {
  const f = await fixture(true);
  const response = await f.post("x");
  expect(response.status).toBe(403);
  await expect(
    readFile(join(f.options.stateDir, "module-preparation-state.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    (await f.host.store.read())!.frozen.modules.find((entry) => entry.module === MODULE)!.request,
  ).toBeNull();
});
