import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, type FirstSetupHold } from "./index.js";
import { lockVenueDatabase } from "@waitron/db";
import type { OperationBinding } from "@waitron/module";
import { createModulePreparationState } from "./module-preparation-state.js";

vi.mock("node:fs/promises", { spy: true });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "setup",
  eventId: "event1",
  sourceId: "attempt1",
  targetNodeId: "node1",
};
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "module-preparation-")));
  roots.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await fs.mkdir(stateDir);
  await fs.mkdir(venueDir);
  const coordinator = createFirstSetupCoordinator();
  let allowed = true;
  const options = {
    stateDir,
    venueDir,
    coordinator,
    authorize: async (selected: OperationBinding) => {
      if (!allowed || selected.targetNodeId !== "node1") throw new Error("owner changed");
    },
    withVenueExclusion: async <T>(run: () => Promise<T>) => {
      const lock = await lockVenueDatabase(venueDir);
      try {
        return await run();
      } finally {
        lock.release();
      }
    },
  };
  const create = () => createModulePreparationState(options);
  return {
    root,
    stateDir,
    venueDir,
    options,
    create,
    store: create(),
    coordinator,
    deny() {
      allowed = false;
    },
    path: join(stateDir, "module-preparation-state.json"),
  };
}
it("durably retains module revisions and reconnects after process-local state is lost", async () => {
  const f = await fixture();
  await f.store.withState(binding, async (state) => {
    expect(state.value).toBeNull();
    await state.replace({ entries: [{ identity: "06RB" }] });
  });
  await f.create().withState({ ...binding, eventId: "event2" }, async (state) => {
    expect(state.value).toEqual({ entries: [{ identity: "06RB" }] });
    await state.replace({ entries: [{ identity: "06RB" }, { identity: "06RC" }] });
  });
  const saved = JSON.parse(await fs.readFile(f.path, "utf8"));
  expect(saved.revisions).toHaveLength(2);
  expect(saved.revisions[0].value).toEqual({ entries: [{ identity: "06RB" }] });
  expect(saved.revisions[1].binding.eventId).toBe("event2");
  expect((await fs.stat(f.path)).mode & 0o777).toBe(0o600);
});
it("serializes two requests and supplies the latest committed module state", async () => {
  const f = await fixture();
  await Promise.all(
    ["06RB", "06RC"].map((identity) =>
      f.store.withState({ ...binding, eventId: identity }, async (state) => {
        const previous = state.value as { identities: string[] } | null;
        await state.replace({ identities: [...(previous?.identities ?? []), identity] });
      }),
    ),
  );
  await f.store.withState(binding, async (state) => {
    expect(state.value).toEqual({ identities: ["06RB", "06RC"] });
  });
});
it("re-enters an existing shared hold without taking the coordinator again", async () => {
  const f = await fixture();
  await f.coordinator.run(async (hold) => {
    await f.store.withState(
      binding,
      async (state) => {
        await state.replace({ identity: "06RB" });
      },
      hold,
    );
  });
  expect(JSON.parse(await fs.readFile(f.path, "utf8")).revisions).toHaveLength(1);
}, 5000);
it("refuses a counterfeit or expired hold", async () => {
  const f = await fixture();
  await expect(
    f.store.withState(binding, async () => null, { token: Symbol() }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  let used!: FirstSetupHold;
  await f.coordinator.run(async (hold) => {
    used = hold;
  });
  await expect(f.store.withState(binding, async () => null, used)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});
it("keeps another module's opaque state separate", async () => {
  const f = await fixture();
  await f.store.withState(binding, async (state) => state.replace({ identity: "06RB" }));
  await f.store.withState({ ...binding, module: "other" }, async (state) => {
    expect(state.value).toBeNull();
    await state.replace({ other: true });
  });
  await f.store.withState(binding, async (state) => {
    expect(state.value).toEqual({ identity: "06RB" });
  });
});
it("refuses a changed owner before reading or replacing", async () => {
  const f = await fixture();
  f.deny();
  await expect(
    f.store.withState(binding, async (state) => state.replace({ identity: "06RB" })),
  ).rejects.toThrow("owner changed");
  await expect(fs.readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});
it("rechecks ownership after awaited work before persistence", async () => {
  const f = await fixture();
  await expect(
    f.store.withState(binding, async (state) => {
      f.deny();
      await state.replace({ identity: "06RB" });
    }),
  ).rejects.toThrow("owner changed");
  await expect(fs.readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});
it("callback exit expires a captured writer and detaches supplied values", async () => {
  const f = await fixture();
  let writer!: (value: unknown) => Promise<void>;
  const value = { identity: "06RB" };
  await f.store.withState(binding, async (state) => {
    writer = state.replace;
    await state.replace(value);
    value.identity = "changed";
    const read = state.value as typeof value;
    read.identity = "changed-again";
  });
  await expect(writer({ identity: "06RC" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await f.store.withState(binding, async (state) => {
    expect(state.value).toEqual({ identity: "06RB" });
  });
});
it.each(["not-json", "{}", '{"version":2,"revisions":[]}', '{"version":1,"revisions":[{}]}'])(
  "a corrupt ledger %s refuses instead of starting empty",
  async (content) => {
    const f = await fixture();
    await fs.writeFile(f.path, content);
    await expect(
      f.store.withState(binding, async (state) => state.replace({})),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(await fs.readFile(f.path, "utf8")).toBe(content);
  },
);
it("never follows a symlink ledger", async () => {
  const f = await fixture();
  const target = join(f.root, "outside.json");
  await fs.writeFile(target, "{}");
  await fs.symlink(target, f.path);
  await expect(f.store.withState(binding, async () => null)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await fs.readFile(target, "utf8")).toBe("{}");
});
it("retains the committed ledger if its reply is lost", async () => {
  const f = await fixture();
  await expect(
    f.store.withState(binding, async (state) => {
      await state.replace({ identity: "06RB" });
      throw new Error("response lost");
    }),
  ).rejects.toThrow("response lost");
  await f.create().withState(binding, async (state) => {
    expect(state.value).toEqual({ identity: "06RB" });
  });
});
it("does not acknowledge a renamed ledger whose directory sync fails", async () => {
  const f = await fixture();
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  let renamed = false;
  vi.mocked(fs.rename).mockImplementation(async (from, to) => {
    await actual.rename(from, to);
    if (String(to) === f.path) renamed = true;
  });
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (renamed && String(args[0]) === f.stateDir)
      vi.spyOn(handle, "sync").mockRejectedValue(new Error("directory sync refused"));
    return handle;
  });
  await expect(
    f.store.withState(binding, async (state) => {
      await state.replace({ identity: "06RB" });
      return "usable";
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.mocked(fs.open).mockImplementation(actual.open);
  await f.create().withState(binding, async (state) => {
    expect(state.value).toEqual({ identity: "06RB" });
  });
});

it("selected successor workspaces retain spent module history at the original anchor", async () => {
  const { randomUUID } = await import("node:crypto");
  const { createFirstSetupResolutionStore, selectFirstSetupWorkspace, firstSetupAnchorFor } =
    await import("./index.js");
  const f = await fixture();
  await f.store.withState(binding, async (state) => state.replace({ identities: ["06RB"] }));
  await fs.writeFile(join(f.stateDir, "first-setup.json"), "original state");
  await fs.writeFile(join(f.venueDir, "first-setup-claim.json"), "original claim");
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const base = join(f.stateDir, "first-setup-workspaces", workspaceId);
  const next = {
    resolutionId,
    workspaceId,
    anchorStateDir: f.stateDir,
    anchorVenueDir: f.venueDir,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    selectionGeneration: 1,
  };
  const archive = createFirstSetupResolutionStore({ ...f.options });
  const prepared = await archive.prepare(
    {
      resolutionId,
      attemptId: randomUUID(),
      observedRevision: 1,
      observedOwnerGeneration: 1,
      database: "missing",
      authority: "original-password",
      register: { kind: "no-current-master", confirmed: true },
      action: "retire",
      nextWorkspace: next,
    },
    [
      { name: "state/first-setup.json", bytes: Buffer.from("original state") },
      { name: "venue/first-setup-claim.json", bytes: Buffer.from("original claim") },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  await selectFirstSetupWorkspace(f.options, await archive.apply(prepared));
  const successor = createModulePreparationState({
    ...f.options,
    stateDir: next.stateDir,
    venueDir: next.venueDir,
  });
  await successor.withState({ ...binding, eventId: "successor" }, async (state) => {
    expect(state.value).toEqual({ identities: ["06RB"] });
    await state.replace({ identities: ["06RB", "06RC"] });
  });
  expect(await firstSetupAnchorFor(next)).toEqual({ stateDir: f.stateDir, venueDir: f.venueDir });
  expect(JSON.parse(await fs.readFile(f.path, "utf8")).revisions).toHaveLength(2);
  await expect(
    fs.readFile(join(next.stateDir, "module-preparation-state.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(join(f.stateDir, "first-setup.json"), "utf8")).toBe("original state");
});

it("a temporary-file sync refusal preserves the previous committed revision", async () => {
  const f = await fixture();
  await f.store.withState(binding, async (state) => state.replace({ identity: "06RB" }));
  const before = await fs.readFile(f.path);
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  let refused = 0;
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (String(args[0]).includes(".first-setup-") && String(args[0]).endsWith(".tmp")) {
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        refused++;
        throw new Error("file sync refused");
      });
    }
    return handle;
  });
  await expect(
    f.store.withState(binding, async (state) => {
      await state.replace({ identity: "06RC" });
      return "usable";
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(refused).toBe(1);
  expect(await fs.readFile(f.path)).toEqual(before);
  vi.mocked(fs.open).mockImplementation(actual.open);
  await f.create().withState(binding, async (state) => {
    expect(state.value).toEqual({ identity: "06RB" });
  });
});
it.each([undefined, NaN, new Map(), { missing: undefined }])(
  "non-JSON module value %j refuses before changing the ledger",
  async (value) => {
    const f = await fixture();
    await expect(
      f.store.withState(binding, async (state) => state.replace(value)),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    await expect(fs.readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("a malformed operation binding cannot create module history", async () => {
  const f = await fixture();
  await expect(
    f.store.withState({ ...binding, eventId: "" }, async (state) =>
      state.replace({ identity: "06RB" }),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(fs.readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains every module revision when a caller restores an older module value", async () => {
  const f = await fixture();
  await f.store.withState(binding, async (state) => state.replace({ identity: "06RB" }));
  await f.store.withState({ ...binding, eventId: "second" }, async (state) =>
    state.replace({ identity: "06RC" }),
  );
  await f.store.withState({ ...binding, eventId: "restored" }, async (state) =>
    state.replace({ identity: "06RB" }),
  );
  await f.create().withState(binding, async (state) => {
    expect(state.history).toEqual([
      { identity: "06RB" },
      { identity: "06RC" },
      { identity: "06RB" },
    ]);
  });
});
