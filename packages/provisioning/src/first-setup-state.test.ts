import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  unlink,
  symlink,
  realpath,
  readdir,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { hashPassword, hashPin } from "@waitron/identity";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  assertOtherSetupAllowed,
  inspectFirstSetupMarker,
  type FirstSetupFrozen,
  parseState,
} from "./first-setup-state.js";
import * as durable from "./durable-host-json.js";
vi.mock("./durable-host-json.js", { spy: true });

const dirs: string[] = [];
const verifier = hashPassword("owner-password");
const pinHash = hashPin("4826");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function frozen(): FirstSetupFrozen {
  const attemptId = randomUUID();
  return {
    attemptId,
    nodeId: randomUUID(),
    administratorId: randomUUID(),
    sourceId: `first-setup:${attemptId}`,
    environment: "production",
    modules: [
      {
        module: "probe",
        version: "0.1.0",
        eventId: randomUUID(),
        request: { bases: ["S000001-W1-A"], purposes: ["simplified"] },
      },
    ],
    request: {
      country: "ES",
      taxId: "B12345678",
      legalName: "Olivo SL",
      taxpayerDomicile: "Calle Fiscal 1",
      name: "Olivo",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurante",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      seriesCode: "A",
      fullSeriesCode: "F",
      rectificativeSeriesCode: "R",
      admin: { displayName: "Elena", email: "elena@example.test", pinHash, passwordHash: verifier },
    },
  };
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "first-state-"));
  dirs.push(dir);
  const options = {
    stateDir: join(dir, "independent-state"),
    venueDir: join(dir, "venue"),
    coordinator: createFirstSetupCoordinator(),
  };
  await mkdir(options.venueDir);
  const store = createFirstSetupStore(options);
  const claim = (input = frozen()) => store.claim(input, verifier, digest("capability"));
  return {
    dir,
    options,
    store,
    claim,
    statePath: join(options.stateDir, "flows/setup/record.json"),
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(durable.writeDurableHostJson).mockImplementation(
    (await vi.importActual<typeof import("./durable-host-json.js")>("./durable-host-json.js"))
      .writeDurableHostJson,
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function interruptedCompletion(f: Awaited<ReturnType<typeof fixture>>) {
  let state = await f.claim();
  for (const change of [
    { kind: "consumption-intent" },
    { kind: "activation-started" },
    { kind: "committed", result: {} },
    { kind: "publication" },
  ] as const)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  const original = (
    await vi.importActual<typeof import("./durable-host-json.js")>("./durable-host-json.js")
  ).writeDurableHostJson;
  let calls = 0;
  vi.spyOn(durable, "writeDurableHostJson").mockImplementation(async (...args) => {
    if (++calls === 1) throw new Error("completion-record-fault");
    return original(...args);
  });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, { kind: "complete" }),
  ).rejects.toThrow("completion-record-fault");
  vi.restoreAllMocks();
  return (await f.store.readResumable())!.state;
}

it("refuses a frozen request with nested venue fields", async () => {
  const f = await fixture();
  const state = await f.claim();
  const {
    name,
    fiscalTerritory,
    invoiceLocales,
    operationDescription,
    addressLine1,
    addressLine2,
    postalCode,
    city,
    province,
    timeZone,
    dayCutover,
    ...identity
  } = state.frozen.request;
  const venueDoc = {
    name,
    fiscalTerritory,
    invoiceLocales,
    operationDescription,
    addressLine1,
    addressLine2,
    postalCode,
    city,
    province,
    timeZone,
    dayCutover,
  };
  state.frozen.request = { ...identity, extra: venueDoc } as unknown as FirstSetupFrozen["request"];
  expect(() => parseState(state, f.options.venueDir, f.options.stateDir)).toThrowError(
    expect.objectContaining({ code: "setup.attempt_invalid" }),
  );
});

it("accepts the flat request", async () => {
  const f = await fixture();
  const input = frozen();
  const request = input.request;
  const state = await f.claim({ ...input, request });
  expect(state.frozen.request).toEqual(request);
  expect((await f.store.read())?.frozen.request).toEqual(request);
});

it.each(["en", "es"] as const)(
  "retains explicit %s working language across a setup restart",
  async (staffLanguage) => {
    const f = await fixture();
    const input = frozen();
    input.request.staffLanguage = staffLanguage;
    await f.claim(input);
    const restarted = createFirstSetupStore(f.options);
    expect((await restarted.read())?.frozen.request).toEqual(input.request);
  },
);

it.each([null, "en-GB", "fr", ["en"]])(
  "refuses an invalid frozen working language %j before saving the claim",
  async (staffLanguage) => {
    const f = await fixture();
    const input = frozen();
    input.request.staffLanguage = staffLanguage as never;
    await expect(f.claim(input)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(await f.store.read()).toBeNull();
  },
);

it.each([null, "es-ES", []])(
  "refuses a frozen receipt-language value of %j before saving the claim",
  async (invoiceLocales) => {
    const f = await fixture();
    const input = frozen();
    input.request.invoiceLocales = invoiceLocales as never;
    await expect(f.claim(input)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(await f.store.read()).toBeNull();
  },
);

it("does not read a bound venue replaced by a symlink after claiming", async () => {
  const f = await fixture();
  await f.claim();
  const before = await readFile(f.statePath);
  const moved = join(f.dir, "relocated-venue");
  const filesystem = await import("node:fs/promises");
  await filesystem.rename(f.options.venueDir, moved);
  await symlink(moved, f.options.venueDir);
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await readFile(f.statePath)).toEqual(before);
});

it("lets one simultaneous claim win and retains its exact identities across restart", async () => {
  const f = await fixture();
  const input = frozen();
  const results = await Promise.allSettled([f.claim(input), f.claim()]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect(results[1]).toMatchObject({ reason: { code: "setup.attempt_conflict" } });
  const state = await createFirstSetupStore(f.options).read();
  expect(state?.frozen).toEqual(input);
  expect(state?.revision).toBe(1);
  expect(await inspectFirstSetupMarker(f.options.venueDir, f.options.stateDir)).toMatchObject({
    status: "active",
    attemptId: input.attemptId,
  });
  const bytes = await readFile(f.statePath, "utf8");
  for (const secret of ["owner-password", '"4826"', '"capability"'])
    expect(bytes).not.toContain(secret);
});

it("rejects stale revisions and frozen edits without changing the durable attempt", async () => {
  const f = await fixture();
  const state = await f.claim();
  await expect(
    f.store.update(state.frozen.attemptId, 0, { kind: "consumption-intent" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  for (const replacement of [
    { taxId: "B99999999" },
    { environment: "preproduction" },
    { modules: [] },
    { admin: { password: "SECRET-SENTINEL" } },
    { bases: ["other"] },
  ]) {
    await expect(
      f.store.update(state.frozen.attemptId, 1, {
        kind: "input",
        module: "probe",
        input: {},
        ...replacement,
      } as never),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  }
  expect(await f.store.read()).toEqual(state);
});

it("retains consumption intent and refuses free-again or unfinished completion after restart", async () => {
  const f = await fixture();
  const state = await f.claim();
  const consumed = await f.store.update(state.frozen.attemptId, 1, { kind: "consumption-intent" });
  expect(consumed.status).toBe("consumption-intent");
  await expect(
    f.store.update(state.frozen.attemptId, 2, { kind: "complete" }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  const fresh = createFirstSetupStore(f.options);
  expect(() => assertOtherSetupAllowed(consumed)).toThrowError(
    expect.objectContaining({ code: "setup.attempt_uncertain" }),
  );
  const abandoned = await fresh.update(state.frozen.attemptId, 2, { kind: "abandoned" });
  expect(abandoned.consumptionIntent).toBe(true);
  expect(() => assertOtherSetupAllowed(abandoned)).toThrowError(
    expect.objectContaining({ code: "setup.attempt_uncertain" }),
  );
  await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
});

it("keeps abandoned history and requires new event identities before another claim", async () => {
  const f = await fixture();
  const state = await f.claim();
  const abandoned = await f.store.update(state.frozen.attemptId, 1, { kind: "abandoned" });
  expect(() => assertOtherSetupAllowed(abandoned)).not.toThrow();
  await expect(f.claim(state.frozen)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  const next = await f.claim();
  expect(next.previous).toHaveLength(1);
  expect(next.previous[0]?.frozen).toEqual(state.frozen);
  expect(next.previous[0]?.history.map((event) => event.kind)).toEqual(["claim", "abandoned"]);
});

it("marks completion only after the actual commit and publication events", async () => {
  const f = await fixture();
  let state = await f.claim();
  for (const change of [
    { kind: "consumption-intent" },
    { kind: "activation-started" },
    { kind: "committed", result: { nodeId: state.frozen.nodeId } },
    { kind: "publication" },
    { kind: "complete" },
  ] as const) {
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  }
  expect(state.status).toBe("complete");
  expect(() => assertOtherSetupAllowed(state)).not.toThrow();
  expect(await inspectFirstSetupMarker(f.options.venueDir, f.options.stateDir)).toMatchObject({
    status: "complete",
  });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, { kind: "consumption-intent" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await unlink(f.statePath);
  expect(await f.store.read()).toBeNull();
});

it.each(["corrupt", "version", "oversize", "symlink", "wrong-root"])(
  "refuses %s rather than starting over",
  async (kind) => {
    const f = await fixture();
    await f.claim();
    if (kind === "corrupt") await writeFile(f.statePath, "{");
    if (kind === "version") await writeFile(f.statePath, JSON.stringify({ version: 2 }));
    if (kind === "oversize") await writeFile(f.statePath, " ".repeat(1024 * 1024 + 1));
    if (kind === "symlink") {
      await unlink(f.statePath);
      await writeFile(join(f.dir, "target"), "{}");
      await symlink(join(f.dir, "target"), f.statePath);
    }
    if (kind === "wrong-root") {
      const value = JSON.parse(await readFile(f.statePath, "utf8"));
      value.attempt.stateDir = join(f.dir, "wrong");
      await writeFile(f.statePath, JSON.stringify(value));
    }
    await expect(createFirstSetupStore(f.options).read()).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  },
);

it("inspects the setup record with its configured state directory", async () => {
  const f = await fixture();
  await f.claim();
  const marker = await inspectFirstSetupMarker(f.options.venueDir, f.options.stateDir);
  expect(marker?.stateDir).toBe(await realpath(f.options.stateDir));
  await writeFile(f.statePath, "{");
  await expect(
    inspectFirstSetupMarker(f.options.venueDir, f.options.stateDir),
  ).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("refuses secret-bearing imports and retains the last valid state", async () => {
  const f = await fixture();
  const state = await f.claim();
  for (const input of [
    { password: "SECRET-SENTINEL" },
    { trust: {} },
    { nested: { privateKey: "SECRET-SENTINEL" } },
  ]) {
    await expect(
      f.store.update(state.frozen.attemptId, 1, { kind: "input", module: "probe", input }),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid", params: {} });
  }
  expect(await f.store.read()).toEqual(state);
});

it("serializes full callbacks and permits only the explicitly held internal context", async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((r) => {
    entered = r;
  });
  const held = new Promise<void>((r) => {
    release = r;
  });
  const effects: string[] = [];
  const legacy = f.options.coordinator.run(async (hold) => {
    effects.push("legacy");
    entered();
    await held;
    expect(await f.store.read()).toBeNull();
    return hold;
  });
  await enteredPromise;
  const claim = f.claim();
  expect(effects).toEqual(["legacy"]);
  release();
  const expired = await legacy;
  await claim;
  await expect(
    f.store.update((await f.store.read())!.frozen.attemptId, 1, { kind: "abandoned" }, expired),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("refuses a full history rather than pruning it to admit a later event", async () => {
  const f = await fixture();
  const state = await f.claim();
  await expect(
    f.store.update(state.frozen.attemptId, 1, {
      kind: "input",
      module: "probe",
      input: { data: "界".repeat(350000) },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await f.store.read()).toEqual(state);
});
it.each(["taxpayer", "bases", "admin", "modules", "environment"])(
  "detects a changed frozen %s in stored history",
  async (field) => {
    const f = await fixture();
    await f.claim();
    const envelope = JSON.parse(await readFile(f.statePath, "utf8"));
    const disk = envelope.attempt;
    if (field === "taxpayer") disk.frozen.request.taxId = "B99999999";
    if (field === "bases") disk.frozen.modules[0].request.bases = ["S000002-W1-A"];
    if (field === "admin") disk.frozen.request.admin.email = "another@example.test";
    if (field === "modules") disk.frozen.modules = [];
    if (field === "environment") disk.frozen.environment = "preproduction";
    await writeFile(f.statePath, JSON.stringify(envelope));
    await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  },
);

it("binds roots to their real paths and rejects replacing a bound directory with a link", async () => {
  const f = await fixture();
  const state = await f.claim();
  expect(state.venueDir).toBe(await realpath(f.options.venueDir));
  expect(state.stateDir).toBe(await realpath(f.options.stateDir));
  const away = join(f.dir, "away");
  const { rename } = await import("node:fs/promises");
  await rename(f.options.stateDir, away);
  await symlink(away, f.options.stateDir);
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});
it.each([1])("retains no setup when its record write %s is interrupted", async (failAt) => {
  const f = await fixture();
  const original = (
    await vi.importActual<typeof import("./durable-host-json.js")>("./durable-host-json.js")
  ).writeDurableHostJson;
  let calls = 0;
  vi.spyOn(durable, "writeDurableHostJson").mockImplementation(async (...args) => {
    calls++;
    if (calls === failAt) throw new Error("synthetic write interruption");
    return original(...args);
  });
  await expect(f.claim()).rejects.toThrow("synthetic write interruption");
  vi.restoreAllMocks();
  expect(await f.store.read()).toBeNull();
});
it.each([1])(
  "never reports completion after its persistence write %s is interrupted",
  async (failAt) => {
    const f = await fixture();
    let state = await f.claim();
    for (const change of [
      { kind: "consumption-intent" },
      { kind: "activation-started" },
      { kind: "committed", result: {} },
      { kind: "publication" },
    ] as const)
      state = await f.store.update(state.frozen.attemptId, state.revision, change);
    const original = (
      await vi.importActual<typeof import("./durable-host-json.js")>("./durable-host-json.js")
    ).writeDurableHostJson;
    let calls = 0;
    vi.spyOn(durable, "writeDurableHostJson").mockImplementation(async (...args) => {
      calls++;
      if (calls === failAt) throw new Error("synthetic write interruption");
      return original(...args);
    });
    await expect(
      f.store.update(state.frozen.attemptId, state.revision, { kind: "complete" }),
    ).rejects.toThrow("synthetic write interruption");
    vi.restoreAllMocks();
    expect((await f.store.read())?.status).toBe("publication");
  },
);

it("records valid public imports and checks", async () => {
  const f = await fixture();
  let state = await f.claim();
  state = await f.store.update(state.frozen.attemptId, 1, {
    kind: "input",
    module: "probe",
    input: { signed: "public", list: [true, 2, null] },
  });
  state = await f.store.update(state.frozen.attemptId, 2, { kind: "checked", module: "probe" });
  expect(state.ownerGeneration).toBe(1);
  expect(state.inputs).toEqual({ probe: { signed: "public", list: [true, 2, null] } });
  expect(state.status).toBe("claimed");
  expect(state.history.map((event) => event.kind)).toEqual(["claim", "input", "checked"]);
});

it("rejects unknown modules, duplicate consumption, wrong IDs and backward phases", async () => {
  const f = await fixture();
  let state = await f.claim();
  for (const change of [
    { kind: "input", module: "absent", input: {} },
    { kind: "checked", module: "absent" },
    { kind: "resume", capabilityHash: "invalid" },
    { kind: "new" },
  ] as const)
    await expect(f.store.update(state.frozen.attemptId, 1, change as never)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  for (const change of [
    { kind: "activation-started" },
    { kind: "committed", result: {} },
    { kind: "publication" },
  ] as const)
    await expect(f.store.update(state.frozen.attemptId, 1, change)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  await expect(f.store.update(randomUUID(), 1, { kind: "abandoned" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  state = await f.store.update(state.frozen.attemptId, 1, { kind: "consumption-intent" });
  for (const change of [
    { kind: "input", module: "probe", input: {} },
    { kind: "checked", module: "probe" },
    { kind: "consumption-intent" },
  ] as const)
    await expect(f.store.update(state.frozen.attemptId, 2, change)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  state = await f.store.update(state.frozen.attemptId, 2, { kind: "uncertain" });
  expect(state.status).toBe("uncertain");
  expect(() => assertOtherSetupAllowed(state)).toThrowError(
    expect.objectContaining({ code: "setup.attempt_uncertain" }),
  );
});
it("a publication attempt cannot start activation again", async () => {
  const f = await fixture();
  let state = await f.claim();
  for (const change of [
    { kind: "consumption-intent" },
    { kind: "activation-started" },
    { kind: "committed", result: {} },
    { kind: "publication" },
  ] as const)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  const bytes = await readFile(f.statePath);
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, { kind: "activation-started" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(f.statePath)).toEqual(bytes);
});
it("rejects an empty attempt mutation and a new claim after completion", async () => {
  const f = await fixture();
  await expect(f.store.update(randomUUID(), 1, { kind: "abandoned" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  let state = await f.claim();
  for (const change of [
    { kind: "consumption-intent" },
    { kind: "activation-started" },
    { kind: "committed", result: {} },
    { kind: "publication" },
    { kind: "complete" },
  ] as const)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});
it.each([
  ["version", 2],
  ["revision", 0],
  ["ownerGeneration", 0],
  ["capabilityHash", "bad"],
  ["ownerVerifier", "scrypt$bad"],
  ["status", "free"],
  ["consumptionIntent", "false"],
  ["history", []],
  ["inputs", []],
  ["previous", [{}]],
  ["extra", "unrecognised"],
])("refuses malformed durable %s", async (field, value) => {
  const f = await fixture();
  await f.claim();
  const envelope = JSON.parse(await readFile(f.statePath, "utf8"));
  const disk = envelope.attempt;
  disk[field as string] = value;
  await writeFile(f.statePath, JSON.stringify(envelope));
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});
it("refuses a saved record that still carries the retired claim nonce hash", async () => {
  const f = await fixture();
  await f.claim();
  const envelope = JSON.parse(await readFile(f.statePath, "utf8"));
  const disk = envelope.attempt;
  disk.claimNonceHash = digest("client-nonce");
  await writeFile(f.statePath, JSON.stringify(envelope));
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});
it("refuses a previous attempt that still carries the retired claim nonce hash", async () => {
  const f = await fixture();
  const first = await f.claim();
  await f.store.update(first.frozen.attemptId, first.revision, { kind: "abandoned" });
  await f.claim();
  const envelope = JSON.parse(await readFile(f.statePath, "utf8"));
  const disk = envelope.attempt;
  disk.previous[0].claimNonceHash = digest("x");
  await writeFile(f.statePath, JSON.stringify(envelope));
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});
it("writes no claim nonce hash when a setup is claimed", async () => {
  const f = await fixture();
  expect(await f.claim()).not.toHaveProperty("claimNonceHash");
  expect(JSON.parse(await readFile(f.statePath, "utf8")).attempt).not.toHaveProperty(
    "claimNonceHash",
  );
});
it.each([
  { attemptId: "not-a-uuid" },
  { sourceId: "different" },
  { nodeId: "wrong" },
  { environment: "dev" },
  { modules: [{ module: "UPPER", version: "0.1.0", eventId: randomUUID(), request: {} }] },
  { modules: [{ module: "probe", version: 0, eventId: randomUUID(), request: {} }] },
  { modules: [{ module: "probe", version: "0.1.0", eventId: "bad", request: {} }] },
])("refuses invalid frozen identity %j before writing a marker", async (change) => {
  const f = await fixture();
  await expect(f.claim({ ...frozen(), ...change } as never)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await f.store.read()).toBeNull();
});
it("rejects duplicates and raw admin input rather than persisting them", async () => {
  const f = await fixture();
  const input = frozen();
  const duplicate = { ...input, modules: [...input.modules, ...input.modules] };
  await expect(f.claim(duplicate)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  for (const admin of [
    { ...input.request.admin, password: "SECRET" },
    { ...input.request.admin, pinHash: "raw-pin" },
    { ...input.request.admin, email: "" },
  ])
    await expect(
      f.claim({ ...input, request: { ...input.request, admin } } as never),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  for (const bad of ["bad", "a".repeat(63)])
    await expect(f.store.claim(input, verifier, bad)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  await expect(f.store.claim(input, hashPassword("other"), digest("cap"))).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await f.store.read()).toBeNull();
});
it("refuses an oversized first snapshot before saving the record", async () => {
  const f = await fixture();
  const input = frozen();
  input.request.legalName = "a".repeat(1024 * 1024);
  await expect(f.claim(input)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(readFile(f.statePath)).rejects.toMatchObject({ code: "ENOENT" });
});
it("allows internal held mutations, rejecting non-public and unbounded nested inputs", async () => {
  const f = await fixture();
  const state = await f.options.coordinator.run(async (hold) =>
    f.store.claim(frozen(), verifier, digest("cap"), hold),
  );
  await f.options.coordinator.run(async (hold) => {
    const updated = await f.store.update(
      state.frozen.attemptId,
      1,
      { kind: "checked", module: "probe" },
      hold,
    );
    expect(updated.revision).toBe(2);
  });
  let nested: unknown = {};
  for (let i = 0; i < 32; i++) nested = { value: nested };
  for (const input of [nested, { unsupported: undefined }, { callback: () => {} }])
    await expect(
      f.store.update(state.frozen.attemptId, 2, { kind: "input", module: "probe", input }),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});

it.each(["verifier", "history-order", "history-kind", "history-consumption"])(
  "rejects inconsistent %s within the stored event",
  async (kind) => {
    const f = await fixture();
    await f.claim();
    const envelope = JSON.parse(await readFile(f.statePath, "utf8"));
    const disk = envelope.attempt;
    if (kind === "verifier") disk.ownerVerifier = hashPassword("different-owner");
    if (kind === "history-order") disk.history[0].revision = 2;
    if (kind === "history-kind") disk.history[0].kind = "input";
    if (kind === "history-consumption") disk.consumptionIntent = true;
    await writeFile(f.statePath, JSON.stringify(envelope));
    await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  },
);

it("retains the module's declared release version rather than a migration counter", async () => {
  const f = await fixture();
  const input = frozen();
  input.modules[0]!.version = "0.1.0";
  expect((await f.claim(input)).frozen.modules[0]?.version).toBe("0.1.0");
});

it("freezes a validated public request before consumption and admits only its first later public import", async () => {
  const f = await fixture();
  const initial = frozen();
  initial.modules[0]!.request = null;
  let state = await f.claim(initial);
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "candidates",
    module: "probe",
    request: { candidateDigest: "public-digest" },
  });
  expect(state.frozen.modules[0]!.request).toEqual({ candidateDigest: "public-digest" });
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "consumption-intent",
  });
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "import",
    module: "probe",
    input: { allocationId: "outside-1" },
  });
  expect(state.inputs.probe).toEqual({ allocationId: "outside-1" });
  for (const change of [
    { kind: "candidates", module: "probe", request: { candidateDigest: "edited" } },
    { kind: "import", module: "probe", input: { allocationId: "outside-2" } },
  ] as const)
    await expect(
      f.store.update(state.frozen.attemptId, state.revision, change),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.store.read())!.inputs.probe).toEqual({ allocationId: "outside-1" });
});
it("keeps an interrupted completion out of trading", async () => {
  const f = await fixture();
  const state = await interruptedCompletion(f);
  expect((await f.store.read())?.status).toBe("publication");
  const pending = await f.store.readResumable();
  expect(pending?.publicationComplete).toBe(false);
  expect(pending?.state.status).toBe("publication");
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, { kind: "publication" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("locks the public publication binding after consumption and never replaces it on retry", async () => {
  const f = await fixture();
  let state = await f.claim();
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, {
      kind: "publication-binding",
      digest: "a".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "consumption-intent",
  });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, {
      kind: "publication-binding",
      digest: "short",
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const before = state;
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "publication-binding",
    digest: "a".repeat(64),
  });
  expect(state.inputs.$publication).toEqual({ digest: "a".repeat(64) });
  expect(state.revision).toBe(before.revision + 1);
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, {
      kind: "publication-binding",
      digest: "b".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.store.read()).toEqual(state);
});
it("refuses candidate and post-consumption imports for modules outside the frozen request", async () => {
  const f = await fixture();
  let state = await f.claim();
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, {
      kind: "candidates",
      module: "unknown",
      request: {},
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, {
      kind: "candidates",
      module: "probe",
      request: {},
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "consumption-intent",
  });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, {
      kind: "import",
      module: "unknown",
      input: {},
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await f.store.read()).toEqual(state);
});

it("retains the exact configuration import binding and refuses a changed digest after restart", async () => {
  const f = await fixture();
  const input = { ...frozen(), configurationImport: { digest: "a".repeat(64), newTaxpayer: true } };
  await f.claim(input);
  expect((await createFirstSetupStore(f.options).read())?.frozen.configurationImport).toEqual({
    digest: "a".repeat(64),
    newTaxpayer: true,
  });
  const envelope = JSON.parse(await readFile(f.statePath, "utf8"));
  const disk = envelope.attempt;
  disk.frozen.configurationImport.digest = "b".repeat(64);
  await writeFile(f.statePath, JSON.stringify(envelope));
  await expect(createFirstSetupStore(f.options).read()).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it.each([
  null,
  {},
  { digest: "not-a-digest", newTaxpayer: false },
  { digest: 1, newTaxpayer: false },
  { digest: "a".repeat(64), newTaxpayer: "false" },
  { digest: "a".repeat(64), newTaxpayer: false, path: "/foreign" },
])(
  "refuses malformed configuration import binding %j before claiming",
  async (configurationImport) => {
    const f = await fixture();
    await expect(
      f.claim({ ...frozen(), configurationImport } as FirstSetupFrozen),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    await expect(readFile(f.statePath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["resume", "recover"])("refuses a record carrying a %s event", async (kind) => {
  const f = await fixture();
  await f.claim();
  const record = JSON.parse(await readFile(f.statePath, "utf8"));
  record.attempt.revision = 2;
  record.attempt.history.push({ kind, revision: 2, ownerGeneration: 1 });
  await writeFile(f.statePath, JSON.stringify(record));
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});

const EVERY_CHANGE = [
  { kind: "input", module: "probe", input: {} },
  { kind: "import", module: "probe", input: {} },
  { kind: "candidates", module: "probe", request: {} },
  { kind: "publication-binding", digest: "a".repeat(64) },
  { kind: "checked", module: "probe" },
  { kind: "consumption-intent" },
  { kind: "activation-started" },
  { kind: "committed", result: {} },
  { kind: "publication" },
  { kind: "complete" },
  { kind: "abandoned" },
  { kind: "uncertain" },
] as const;

it.each(EVERY_CHANGE)("an abandoned attempt refuses a $kind change", async (change) => {
  const f = await fixture();
  const claimed = await f.claim();
  const abandoned = await f.store.update(claimed.frozen.attemptId, claimed.revision, {
    kind: "abandoned",
  });
  const bytes = await readFile(f.statePath);
  await expect(
    f.store.update(abandoned.frozen.attemptId, abandoned.revision, change),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(f.statePath)).toEqual(bytes);
  expect((await f.store.read())?.status).toBe("abandoned");
});

it("a claim writes only the setup record", async () => {
  const f = await fixture();
  const state = await f.claim();
  expect(JSON.parse(await readFile(f.statePath, "utf8")).attempt).toEqual(state);
  const files = await readdir(f.options.venueDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  expect(files).toEqual([]);
});

it("reads an interrupted setup from its record without a venue claim", async () => {
  const f = await fixture();
  const state = await f.claim();
  expect(await createFirstSetupStore(f.options).readResumable()).toEqual({
    state,
    publicationComplete: false,
  });
});

it("reads publication complete from the setup record", async () => {
  const f = await fixture();
  let state = await f.claim();
  for (const change of [
    { kind: "consumption-intent" },
    { kind: "activation-started" },
    { kind: "committed", result: {} },
    { kind: "publication" },
    { kind: "complete" },
  ] as const)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  expect(await createFirstSetupStore(f.options).readResumable()).toEqual({
    state,
    publicationComplete: true,
  });
});

it("stores the attempt inside the flow record", async () => {
  const f = await fixture();
  const state = await f.claim();
  expect(JSON.parse(await readFile(f.statePath, "utf8"))).toEqual({ version: 1, attempt: state });
});
