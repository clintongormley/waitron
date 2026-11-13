import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, type FirstSetupHold } from "./index.js";
import { lockVenueDatabase } from "@waitron/db";
import type { AppError } from "@waitron/shared";
import type { OperationBinding } from "@waitron/module";
import {
  createModulePreparationState,
  mergeModulePreparationRevisions,
  modulePreparationMergeFits,
  readModulePreparationHistory,
  readModulePreparationRevisions,
} from "./module-preparation-state.js";

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

it("a successor preparation state keeps spent module history in the attempt's own folders", async () => {
  const f = await fixture();
  await f.store.withState(binding, async (state) => state.replace({ identities: ["06RB"] }));
  await fs.writeFile(join(f.stateDir, "first-setup.json"), "original state");
  const successor = createModulePreparationState({ ...f.options });
  await successor.withState({ ...binding, eventId: "successor" }, async (state) => {
    expect(state.value).toEqual({ identities: ["06RB"] });
    await state.replace({ identities: ["06RB", "06RC"] });
  });
  expect(JSON.parse(await fs.readFile(f.path, "utf8")).revisions).toHaveLength(2);
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
it("checks a wait's grant without spending it, and spends it on any other write", async () => {
  const f = await fixture();
  const spent: string[] = [];
  const store = createModulePreparationState({
    ...f.options,
    authorizeReplacement: async () => {
      spent.push("spend");
    },
    authorizeWait: async () => {
      spent.push("check");
    },
  });
  await store.withState(binding, async (state) => {
    await state.replace({ entries: [{ kind: "wait" }] }, "wait");
  });
  expect(spent).toEqual(["check"]);
  await store.withState(binding, async (state) => {
    await state.replace({ entries: [{ kind: "wait" }, { kind: "intent" }] });
  });
  expect(spent).toEqual(["check", "spend"]);
  expect(JSON.parse(await fs.readFile(f.path, "utf8")).revisions).toHaveLength(2);
});
it("writes no wait when the grant check refuses", async () => {
  const f = await fixture();
  const store = createModulePreparationState({
    ...f.options,
    authorizeReplacement: async () => {},
    authorizeWait: async () => {
      throw new Error("no grant");
    },
  });
  await expect(
    store.withState(binding, (state) => state.replace({ entries: [] }, "wait")),
  ).rejects.toThrow("no grant");
  await expect(fs.readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("reads every module's revisions in the order they were written, bindings included", async () => {
  const { options } = await fixture();
  const state = createModulePreparationState(options);
  const other = { ...binding, module: "payments", eventId: "event2" };
  await state.withState(binding, (s) => s.replace({ selected: "AAAAA" }));
  await state.withState(other, (s) => s.replace(null));
  await state.withState(binding, (s) => s.replace({ selected: "BBBBB" }));
  expect(await readModulePreparationRevisions({ stateDir: options.stateDir })).toEqual([
    { binding, value: { selected: "AAAAA" } },
    { binding: other, value: null },
    { binding, value: { selected: "BBBBB" } },
  ]);
});

it("reads no revisions when the file is absent", async () => {
  const { options } = await fixture();
  expect(await readModulePreparationRevisions({ stateDir: options.stateDir })).toEqual([]);
});

it("refuses to read revisions from a file that is not the file's format", async () => {
  const { options } = await fixture();
  await fs.writeFile(
    join(options.stateDir, "module-preparation-state.json"),
    JSON.stringify({ version: 1, revisions: [{ binding: {}, value: 1 }] }),
  );
  await expect(
    readModulePreparationRevisions({ stateDir: options.stateDir }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});

describe("a damaged file names itself in the log", () => {
  const FILE = "module-preparation-state.json";

  async function damagedRefusal(text: string): Promise<unknown[]> {
    const f = await fixture();
    await fs.writeFile(join(f.stateDir, FILE), text);
    return Promise.all([
      readModulePreparationRevisions({ stateDir: f.stateDir }).catch((e: unknown) => e),
      readModulePreparationHistory(f.options, "fiscal-verifactu").catch((e: unknown) => e),
      f.store.withState(binding, () => Promise.resolve()).catch((e: unknown) => e),
    ]);
  }

  it.each([
    ["not JSON", "{ not json"],
    ["the wrong shape", JSON.stringify({ version: 2, revisions: [] })],
    ["a bad revision", JSON.stringify({ version: 1, revisions: [{ binding: {}, value: 1 }] })],
    ["over the size limit", " ".repeat(1024 * 1024 + 1)],
  ])("every read of a file that is %s", async (_name, text) => {
    for (const refusal of await damagedRefusal(text)) {
      expect(refusal).toMatchObject({ code: "setup.attempt_invalid", params: {} });
      expect((refusal as AppError).reason).toContain(FILE);
      expect(JSON.stringify(refusal)).not.toContain(FILE);
    }
  });

  it("a file that read correctly and then failed to close is not called damaged", async () => {
    const f = await fixture();
    await fs.writeFile(join(f.stateDir, FILE), JSON.stringify({ version: 1, revisions: [] }));
    const { open } = await vi.importActual<typeof fs>("node:fs/promises");
    const closeFailure = Object.assign(new Error("close failed"), { code: "EIO" });
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        throw closeFailure;
      };
      return handle;
    });
    await expect(readModulePreparationRevisions({ stateDir: f.stateDir })).rejects.toBe(
      closeFailure,
    );
  });

  it("control: a file that reads gives no refusal", async () => {
    const f = await fixture();
    await fs.writeFile(join(f.stateDir, FILE), JSON.stringify({ version: 1, revisions: [] }));
    expect(await readModulePreparationRevisions({ stateDir: f.stateDir })).toEqual([]);
  });
});

const LIMIT = 1024 * 1024;
const fileBytes = (revisions: unknown[]) =>
  Buffer.byteLength(JSON.stringify({ version: 1, revisions }));
const largestBytes = (revisions: unknown[]) =>
  Math.max(0, ...revisions.map((revision) => Buffer.byteLength(JSON.stringify(revision))));
/** What a merge asks of the file: its bytes, room for three revisions sized from each list, and 8 KiB. */
const bytesNeeded = (incoming: unknown[], own: unknown[]) =>
  fileBytes([...incoming, ...own]) + 3 * (largestBytes(incoming) + largestBytes(own)) + 8 * 1024;
/** Text under a binding of its own that brings `bytesNeeded` to the limit once listed in `incoming`. */
const textToLimit = (incoming: unknown[], own: unknown[], revisionOf: (text: string) => unknown) =>
  "x".repeat(LIMIT - bytesNeeded([...incoming, revisionOf("")], own));

describe("modulePreparationMergeFits", () => {
  // Small enough that one list's revision and its room fit, and two lists' do not.
  const SIZEABLE = 140 * 1024;
  const stored = (over: Partial<OperationBinding>, text: string) => ({
    binding: { ...binding, ...over },
    value: { text },
  });

  it("takes revisions into a box with no file", async () => {
    const { options } = await fixture();
    const fits = (incoming: ReturnType<typeof stored>[]) =>
      modulePreparationMergeFits({ stateDir: options.stateDir }, incoming);
    expect(await fits([])).toBe(true);
    expect(await fits([stored({}, "a")])).toBe(true);
  });

  it("keeps room for three revisions sized from the largest on each list, plus 8 KiB: its last byte fits, and the next does not", async () => {
    const { options, path } = await fixture();
    const own = [
      stored({ eventId: "own-small" }, "a"),
      stored({ eventId: "own-large" }, "b".repeat(40_000)),
      stored({ eventId: "own-last" }, "c"),
    ];
    await fs.writeFile(path, JSON.stringify({ version: 1, revisions: own }));
    const list = [
      stored({ eventId: "theirs-small" }, "d"),
      stored({ eventId: "theirs-large" }, "e".repeat(60_000)),
      ...Array.from({ length: 12 }, (_, index) =>
        stored({ eventId: `theirs-${index}` }, "f".repeat(50_000)),
      ),
    ];
    const last = (text: string) => stored({ eventId: "theirs-exact" }, text);
    const text = textToLimit(list, own, last);
    const fits = (exact: string) =>
      modulePreparationMergeFits({ stateDir: options.stateDir }, [...list, last(exact)]);
    expect(bytesNeeded([...list, last(text)], own)).toBe(LIMIT);
    expect(await fits(text)).toBe(true);
    expect(await fits(`${text}x`)).toBe(false);
  });

  it("with no file of its own, keeps room sized from the old box's list alone", async () => {
    const { options } = await fixture();
    const list = Array.from({ length: 17 }, (_, index) =>
      stored({ eventId: `theirs-${index}` }, "g".repeat(50_000)),
    );
    const last = (text: string) => stored({ eventId: "theirs-exact" }, text);
    const text = textToLimit(list, [], last);
    expect(bytesNeeded([...list, last(text)], [])).toBe(LIMIT);
    const fits = (exact: string) =>
      modulePreparationMergeFits({ stateDir: options.stateDir }, [...list, last(exact)]);
    expect(await fits(text)).toBe(true);
    expect(await fits(`${text}x`)).toBe(false);
  });

  it("a file already too full to keep that room does not fit, even with nothing to merge", async () => {
    const { options, path } = await fixture();
    const large = stored({ eventId: "large" }, "x".repeat(240_000));
    const last = (text: string) => stored({ eventId: "exact" }, text);
    const write = (text: string) =>
      fs.writeFile(path, JSON.stringify({ version: 1, revisions: [large, last(text)] }));
    const atLimit = "x".repeat(LIMIT - bytesNeeded([], [large, last("")]));
    expect(bytesNeeded([], [large, last(atLimit)])).toBe(LIMIT);
    await write(atLimit);
    expect(await modulePreparationMergeFits({ stateDir: options.stateDir }, [])).toBe(true);
    await write(`${atLimit}x`);
    expect(await modulePreparationMergeFits({ stateDir: options.stateDir }, [])).toBe(false);
  });

  it("counts the file in bytes, not characters", async () => {
    const { options, path } = await fixture();
    const large = stored({ eventId: "large" }, "x".repeat(240_000));
    const last = (text: string) => stored({ eventId: "exact" }, text);
    const twoBytesEach = "é".repeat(
      Math.ceil((LIMIT - bytesNeeded([], [large, last("")]) + 1) / 2),
    );
    expect(bytesNeeded([], [large, last(twoBytesEach)])).toBeGreaterThan(LIMIT);
    await fs.writeFile(
      path,
      JSON.stringify({ version: 1, revisions: [large, last(twoBytesEach)] }),
    );
    expect(await modulePreparationMergeFits({ stateDir: options.stateDir }, [])).toBe(false);
  });

  it("counts this box's own revisions with the incoming ones", async () => {
    const { options } = await fixture();
    const sizeable = "x".repeat(SIZEABLE);
    await createModulePreparationState(options).withState(binding, (s) =>
      s.replace({ text: sizeable }),
    );
    expect(
      await modulePreparationMergeFits({ stateDir: options.stateDir }, [
        stored({ eventId: "another" }, sizeable),
      ]),
    ).toBe(false);
  });

  it("counts once a revision both boxes hold, whatever order its value's keys are in", async () => {
    const { options } = await fixture();
    const sizeable = "x".repeat(SIZEABLE);
    await createModulePreparationState(options).withState(binding, (s) =>
      s.replace({ text: sizeable, other: 1 }),
    );
    expect(
      await modulePreparationMergeFits({ stateDir: options.stateDir }, [
        { binding, value: { other: 1, text: sizeable } },
      ]),
    ).toBe(true);
  });

  it.each([
    ["another value", { binding, value: { text: "y".repeat(SIZEABLE) } }],
    [
      "another binding",
      { binding: { ...binding, action: "other" }, value: { text: "x".repeat(SIZEABLE) } },
    ],
  ])("the same revision but for %s counts as its own", async (_label, revision) => {
    const { options } = await fixture();
    await createModulePreparationState(options).withState(binding, (s) =>
      s.replace({ text: "x".repeat(SIZEABLE) }),
    );
    expect(await modulePreparationMergeFits({ stateDir: options.stateDir }, [revision])).toBe(
      false,
    );
  });

  it("a revision listed twice in one list counts once", async () => {
    const { options } = await fixture();
    const once = stored({}, "x".repeat(240 * 1024));
    expect(await modulePreparationMergeFits({ stateDir: options.stateDir }, [once, once])).toBe(
      true,
    );
  });

  it("a damaged file of its own refuses, as every read of it does", async () => {
    const { options } = await fixture();
    await fs.writeFile(join(options.stateDir, "module-preparation-state.json"), "{not json");
    await expect(
      modulePreparationMergeFits({ stateDir: options.stateDir }, []),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  });
});

describe("mergeModulePreparationRevisions", () => {
  const FILE = "module-preparation-state.json";
  const revision = (eventId: string, value: unknown = { name: eventId }) => ({
    binding: { ...binding, eventId },
    value,
  });
  const [m1, m2, shared] = [revision("m1"), revision("m2"), revision("shared")];
  /** Indented on purpose: a rewrite of the same revisions would not keep these bytes. */
  const place = (stateDir: string, revisions: unknown[]) =>
    fs.writeFile(join(stateDir, FILE), JSON.stringify({ version: 1, revisions }, null, 2));
  const events = async (stateDir: string) =>
    (await readModulePreparationRevisions({ stateDir })).map((row) => row.binding.eventId);

  it("writes the old box's revisions first, so this box's own stays the latest", async () => {
    const { options, store } = await fixture();
    await store.withState(binding, (s) => s.replace({ mine: true }));
    const stateDir = options.stateDir;
    await mergeModulePreparationRevisions({ stateDir }, [m1, m2]);
    expect(await events(stateDir)).toEqual(["m1", "m2", "event1"]);
    const seen = await store.withState(binding, async (s) => ({
      value: s.value,
      history: s.history,
    }));
    expect(seen.value).toEqual({ mine: true });
    expect(seen.history).toEqual([{ name: "m1" }, { name: "m2" }, { mine: true }]);
  });

  it("gives a box with no file the old box's revisions, in their order", async () => {
    const { options } = await fixture();
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [m2, m1]);
    expect(await events(options.stateDir)).toEqual(["m2", "m1"]);
  });

  it("creates no file when there is nothing to merge", async () => {
    const { options, path } = await fixture();
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, []);
    await expect(fs.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a second run with the same revisions leaves the file's bytes as they were", async () => {
    const { options, path } = await fixture();
    await place(options.stateDir, [m2]);
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [m1]);
    const after = await fs.readFile(path);
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [m1]);
    expect(await fs.readFile(path)).toEqual(after);
  });

  it("does not touch this box's file when it already holds every revision", async () => {
    const { options, path } = await fixture();
    await place(options.stateDir, [m1, m2]);
    const before = await fs.readFile(path, "utf8");
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [m2]);
    expect(await fs.readFile(path, "utf8")).toBe(before);
  });

  it("keeps this box's own list as it stands when a revision is on both boxes", async () => {
    const { options, store } = await fixture();
    const own = { ...binding, eventId: "shared" };
    await place(options.stateDir, [m2, shared, m2]);
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [m1, shared]);
    expect(await events(options.stateDir)).toEqual(["m1", "m2", "shared", "m2"]);
    expect(await store.withState(own, async (s) => s.value)).toEqual({ name: "m2" });
  });

  it("knows a revision the wire returned with its keys in another order", async () => {
    const { options, path } = await fixture();
    const { module, action, eventId, sourceId, targetNodeId } = binding;
    await place(options.stateDir, [{ binding, value: { a: 1, b: { c: 2, d: 3 } } }]);
    const before = await fs.readFile(path, "utf8");
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [
      {
        binding: { targetNodeId, sourceId, module, eventId, action },
        value: { b: { d: 3, c: 2 }, a: 1 },
      },
    ]);
    expect(await fs.readFile(path, "utf8")).toBe(before);
  });

  it.each([
    ["another value", { binding: m1.binding, value: { name: "other" } }],
    ["another binding", { binding: { ...m1.binding, action: "other" }, value: m1.value }],
  ])("keeps a revision that differs only by %s", async (_label, other) => {
    const { options } = await fixture();
    await place(options.stateDir, [m1]);
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [other]);
    expect(await readModulePreparationRevisions({ stateDir: options.stateDir })).toEqual([
      other,
      m1,
    ]);
  });

  it("writes a revision the old box listed twice once", async () => {
    const { options } = await fixture();
    await mergeModulePreparationRevisions({ stateDir: options.stateDir }, [m1, m1]);
    expect(await events(options.stateDir)).toEqual(["m1"]);
  });

  it("refuses a damaged file of its own and leaves it there", async () => {
    const { options, path } = await fixture();
    await fs.writeFile(path, "{not json");
    await expect(
      mergeModulePreparationRevisions({ stateDir: options.stateDir }, [m1]),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(await fs.readFile(path, "utf8")).toBe("{not json");
  });

  const textFilling = (total: number) => {
    const bytes = (text: string) =>
      Buffer.byteLength(JSON.stringify({ version: 1, revisions: [revision("m1", { text }), m2] }));
    return "x".repeat(total - bytes(""));
  };

  it("counts the bytes the size check counts: a merge of the most it takes writes exactly those bytes", async () => {
    const { options, path } = await fixture();
    const stateDir = options.stateDir;
    await place(stateDir, [m2]);
    const list = Array.from({ length: 17 }, (_, index) =>
      revision(`m1-${index}`, { text: "x".repeat(50_000) }),
    );
    const last = (text: string) => revision("exact", { text });
    const atLimit = textToLimit(list, [m2], last);
    const bytes = fileBytes([...list, last(atLimit), m2]);
    expect(bytes + 3 * (largestBytes(list) + largestBytes([m2])) + 8 * 1024).toBe(LIMIT);
    expect(await modulePreparationMergeFits({ stateDir }, [...list, last(`${atLimit}x`)])).toBe(
      false,
    );
    const exact = [...list, last(atLimit)];
    expect(await modulePreparationMergeFits({ stateDir }, exact)).toBe(true);
    await mergeModulePreparationRevisions({ stateDir }, exact);
    expect((await fs.stat(path)).size).toBe(bytes);
    expect((await events(stateDir)).slice(-2)).toEqual(["exact", "m2"]);
  });

  it("writes up to the file's own limit, past the size check's margin, and refusing leaves this box's file alone", async () => {
    const { options, path } = await fixture();
    const stateDir = options.stateDir;
    await place(stateDir, [m2]);
    const before = await fs.readFile(path, "utf8");
    const atLimit = textFilling(LIMIT);
    await expect(
      mergeModulePreparationRevisions({ stateDir }, [revision("m1", { text: `${atLimit}x` })]),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(await fs.readFile(path, "utf8")).toBe(before);

    await mergeModulePreparationRevisions({ stateDir }, [revision("m1", { text: atLimit })]);
    expect((await fs.stat(path)).size).toBe(LIMIT);
    expect(await events(stateDir)).toEqual(["m1", "m2"]);
  });

  it("counts this box's own repeats towards the room, while the merge would still be under the file's limit", async () => {
    const { options } = await fixture();
    const stateDir = options.stateDir;
    const own = revision("own", { text: "x".repeat(150 * 1024) });
    await place(stateDir, [own, own]);
    const another = revision("another", { text: "y".repeat(150 * 1024) });
    expect(await modulePreparationMergeFits({ stateDir }, [another])).toBe(false);
    await mergeModulePreparationRevisions({ stateDir }, [another]);
    expect(await events(stateDir)).toEqual(["another", "own", "own"]);
  });

  it("counts this box's own repeats in the size check, because the merge keeps them", async () => {
    const { options } = await fixture();
    const stateDir = options.stateDir;
    const third = revision("third", { text: "x".repeat(LIMIT / 3) });
    await place(stateDir, [third, third]);
    const another = revision("another", { text: "y".repeat(LIMIT / 3) });
    expect(await modulePreparationMergeFits({ stateDir }, [another])).toBe(false);
    await expect(mergeModulePreparationRevisions({ stateDir }, [another])).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  });
});
