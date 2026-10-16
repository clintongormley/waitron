import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile, unlink, symlink, realpath } from "node:fs/promises";
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
      location: {
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
      },
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
  const store = createFirstSetupStore(options);
  const claim = (input = frozen()) =>
    store.claim(input, verifier, digest("capability"), digest("client-nonce"));
  return {
    dir,
    options,
    store,
    claim,
    statePath: join(options.stateDir, "first-setup.json"),
    markerPath: join(options.venueDir, "first-setup-claim.json"),
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
  for (const secret of ["owner-password", '"4826"', '"capability"', '"client-nonce"'])
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
  expect(await inspectFirstSetupMarker(f.options.venueDir)).toMatchObject({ status: "complete" });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, { kind: "consumption-intent" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await unlink(f.statePath);
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});

it.each([
  "corrupt",
  "version",
  "oversize",
  "symlink",
  "missing-state",
  "missing-marker",
  "wrong-root",
  "orphan-marker",
])("refuses %s rather than starting over", async (kind) => {
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
  if (kind === "missing-state") await unlink(f.statePath);
  if (kind === "missing-marker") await unlink(f.markerPath);
  if (kind === "wrong-root") {
    await expect(
      inspectFirstSetupMarker(f.options.venueDir, join(f.dir, "wrong")),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    return;
  }
  if (kind === "orphan-marker") {
    const marker = JSON.parse(await readFile(f.markerPath, "utf8"));
    marker.status = "claiming";
    await writeFile(f.markerPath, JSON.stringify(marker));
  }
  await expect(createFirstSetupStore(f.options).read()).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("checks the fixed venue marker without an environment-selected state directory", async () => {
  const f = await fixture();
  await f.claim();
  const marker = await inspectFirstSetupMarker(f.options.venueDir);
  expect(marker?.stateDir).toBe(await realpath(f.options.stateDir));
  await expect(
    inspectFirstSetupMarker(f.options.venueDir, join(f.dir, "wrong-state")),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await writeFile(f.markerPath, "{");
  await expect(inspectFirstSetupMarker(f.options.venueDir)).rejects.toMatchObject({
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
    const disk = JSON.parse(await readFile(f.statePath, "utf8"));
    if (field === "taxpayer") disk.frozen.request.taxId = "B99999999";
    if (field === "bases") disk.frozen.modules[0].request.bases = ["S000002-W1-A"];
    if (field === "admin") disk.frozen.request.admin.email = "another@example.test";
    if (field === "modules") disk.frozen.modules = [];
    if (field === "environment") disk.frozen.environment = "preproduction";
    await writeFile(f.statePath, JSON.stringify(disk));
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
it.each([1, 2, 3])(
  "retains a refusal-only marker when claim persistence write %s is interrupted",
  async (failAt) => {
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
    if (failAt === 1) expect(await f.store.read()).toBeNull();
    else {
      const marker = JSON.parse(await readFile(f.markerPath, "utf8"));
      expect(marker.status).toBe("claiming");
      await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
      await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    }
  },
);
it.each([1, 2])(
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
    if (failAt === 1) expect((await f.store.read())?.status).toBe("publication");
    else await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  },
);

it("records valid public imports/checks and keeps them through a resume without granting authority", async () => {
  const f = await fixture();
  let state = await f.claim();
  state = await f.store.update(state.frozen.attemptId, 1, {
    kind: "input",
    module: "probe",
    input: { signed: "public", list: [true, 2, null] },
  });
  state = await f.store.update(state.frozen.attemptId, 2, { kind: "checked", module: "probe" });
  state = await f.store.update(state.frozen.attemptId, 3, {
    kind: "resume",
    capabilityHash: digest("rotated"),
  });
  expect(state.ownerGeneration).toBe(2);
  expect(state.inputs).toEqual({ probe: { signed: "public", list: [true, 2, null] } });
  expect(state.status).toBe("claimed");
  expect(state.history.map((event) => event.kind)).toEqual(["claim", "input", "checked", "resume"]);
});

it("records a recovery as a new owner generation with a replacement browser proof", async () => {
  const f = await fixture();
  const before = await f.claim();
  const recovered = await f.store.update(before.frozen.attemptId, before.revision, {
    kind: "recover",
    capabilityHash: digest("recovered-capability"),
    claimNonceHash: digest("new-browser-proof"),
  } as never);
  expect(recovered.frozen).toEqual(before.frozen);
  expect(recovered.ownerVerifier).toBe(before.ownerVerifier);
  expect(recovered.claimNonceHash).toBe(digest("new-browser-proof"));
  expect(recovered.capabilityHash).toBe(digest("recovered-capability"));
  expect(recovered.ownerGeneration).toBe(2);
  expect(recovered.revision).toBe(2);
  expect(recovered.history).toEqual([
    { kind: "claim", revision: 1, ownerGeneration: 1 },
    { kind: "recover", revision: 2, ownerGeneration: 2 },
  ]);
  expect(await createFirstSetupStore(f.options).read()).toEqual(recovered);
});

it.each(["capabilityHash", "claimNonceHash"])(
  "rejects a malformed recovery %s without writing",
  async (field) => {
    const f = await fixture();
    const before = await f.claim();
    const bytes = await readFile(f.statePath);
    await expect(
      f.store.update(before.frozen.attemptId, before.revision, {
        kind: "recover",
        capabilityHash: digest("new-capability"),
        claimNonceHash: digest("new-proof"),
        [field]: "bad",
      } as never),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(await readFile(f.statePath)).toEqual(bytes);
  },
);

it("rebinds an abandoned attempt without reviving it or admitting another mutation", async () => {
  const f = await fixture();
  const before = await f.claim();
  await f.store.update(before.frozen.attemptId, 1, { kind: "abandoned" });
  const bytes = await readFile(f.statePath);
  const recovered = await f.store.update(before.frozen.attemptId, 2, {
    kind: "recover",
    capabilityHash: digest("new-capability"),
    claimNonceHash: digest("new-proof"),
  });
  expect(recovered.status).toBe("abandoned");
  expect(recovered.ownerGeneration).toBe(2);
  expect(recovered.history.slice(0, 2)).toEqual(JSON.parse(bytes.toString()).history);
  await expect(
    f.store.update(before.frozen.attemptId, 3, { kind: "consumption-intent" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.store.read())?.status).toBe("abandoned");
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
  ["claimNonceHash", "bad"],
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
  const disk = JSON.parse(await readFile(f.statePath, "utf8"));
  disk[field as string] = value;
  await writeFile(f.statePath, JSON.stringify(disk));
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
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
    await expect(f.store.claim(input, verifier, bad, digest("nonce"))).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  await expect(f.store.claim(input, verifier, digest("cap"), "bad")).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(
    f.store.claim(input, hashPassword("other"), digest("cap"), digest("nonce")),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await f.store.read()).toBeNull();
});

it("allows internal held mutations, rejecting non-public and unbounded nested inputs", async () => {
  const f = await fixture();
  const state = await f.options.coordinator.run(async (hold) =>
    f.store.claim(frozen(), verifier, digest("cap"), digest("nonce"), hold),
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
it("refuses an oversized first snapshot before exposing a marker", async () => {
  const f = await fixture();
  const input = frozen();
  input.request.legalName = "a".repeat(1024 * 1024);
  await expect(f.claim(input)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(readFile(f.markerPath)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["verifier", "history-order", "history-kind", "history-consumption"])(
  "rejects inconsistent %s within the stored event",
  async (kind) => {
    const f = await fixture();
    await f.claim();
    const disk = JSON.parse(await readFile(f.statePath, "utf8"));
    if (kind === "verifier") disk.ownerVerifier = hashPassword("different-owner");
    if (kind === "history-order") disk.history[0].revision = 2;
    if (kind === "history-kind") disk.history[0].kind = "input";
    if (kind === "history-consumption") disk.consumptionIntent = true;
    await writeFile(f.statePath, JSON.stringify(disk));
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
it("keeps an interrupted completion out of trading while allowing a credential resume to recheck publication", async () => {
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
    if (++calls === 2) throw new Error("completion-marker-fault");
    return original(...args);
  });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, { kind: "complete" }),
  ).rejects.toThrow("completion-marker-fault");
  vi.restoreAllMocks();
  await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const pending = await f.store.readResumable();
  expect(pending?.publicationComplete).toBe(false);
  expect(pending?.state.status).toBe("complete");
  state = await f.store.update(state.frozen.attemptId, pending!.state.revision, {
    kind: "resume",
    capabilityHash: digest("fresh"),
  });
  expect(state.status).toBe("publication");
  expect(state.ownerGeneration).toBe(2);
  expect((await f.store.read())?.status).toBe("publication");
  expect(() => assertOtherSetupAllowed(state)).toThrowError(
    expect.objectContaining({ code: "setup.attempt_uncertain" }),
  );
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
  const disk = JSON.parse(await readFile(f.statePath, "utf8"));
  disk.frozen.configurationImport.digest = "b".repeat(64);
  await writeFile(f.statePath, JSON.stringify(disk));
  await expect(createFirstSetupStore(f.options).read()).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it.each(["claim", "abandon"])(
  "repairs only the %s marker after checking the unused venue",
  async (phase) => {
    const f = await fixture();
    const original = (
      await vi.importActual<typeof import("./durable-host-json.js")>("./durable-host-json.js")
    ).writeDurableHostJson;
    const interrupt = (status: string) =>
      vi.spyOn(durable, "writeDurableHostJson").mockImplementation(async (path, value, ...rest) => {
        if (
          path.endsWith("first-setup-claim.json") &&
          (value as { status: string }).status === status
        )
          throw new Error("interrupted marker");
        return original(path, value, ...rest);
      });
    if (phase === "claim") {
      interrupt("active");
      await expect(f.claim()).rejects.toThrow("interrupted marker");
    } else {
      const state = await f.claim();
      interrupt("abandoned");
      await expect(
        f.store.update(state.frozen.attemptId, 1, { kind: "abandoned" }),
      ).rejects.toThrow("interrupted marker");
    }
    vi.mocked(durable.writeDurableHostJson).mockImplementation(original);
    const bytes = await readFile(f.statePath);
    await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    const inspection = await f.store.readForRepair();
    expect(inspection?.repairMarker).toBe(phase === "claim" ? "active" : "abandoned");
    expect(await readFile(f.statePath)).toEqual(bytes);
    let checked = 0;
    await f.store.repairMarker(inspection!, async () => {
      checked++;
    });
    expect(checked).toBe(1);
    expect(await readFile(f.statePath)).toEqual(bytes);
    expect((await f.store.read())?.status).toBe(phase === "claim" ? "claimed" : "abandoned");
    expect(JSON.parse(await readFile(f.markerPath, "utf8")).status).toBe(
      phase === "claim" ? "active" : "abandoned",
    );
  },
);

it("leaves both files untouched when the unused-venue check refuses marker repair", async () => {
  const f = await fixture();
  await f.claim();
  const marker = JSON.parse(await readFile(f.markerPath, "utf8"));
  marker.status = "claiming";
  await writeFile(f.markerPath, JSON.stringify(marker));
  const stateBytes = await readFile(f.statePath),
    markerBytes = await readFile(f.markerPath);
  const observed = await f.store.readForRepair();
  await expect(
    f.store.repairMarker(observed!, async () => {
      throw Object.assign(new Error(), { code: "setup.attempt_conflict" });
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(f.statePath)).toEqual(stateBytes);
  expect(await readFile(f.markerPath)).toEqual(markerBytes);
});

it("rejects a marker repair when the observed ownership changed before exclusion", async () => {
  const f = await fixture();
  await f.claim();
  const marker = JSON.parse(await readFile(f.markerPath, "utf8"));
  marker.status = "claiming";
  await writeFile(f.markerPath, JSON.stringify(marker));
  const observed = (await f.store.readForRepair())!;
  const changed = JSON.parse(await readFile(f.statePath, "utf8"));
  changed.revision = 2;
  changed.ownerGeneration = 2;
  changed.capabilityHash = digest("replacement-owner");
  changed.history.push({ kind: "recover", revision: 2, ownerGeneration: 2 });
  await writeFile(f.statePath, JSON.stringify(changed));
  const before = await readFile(f.markerPath);
  await expect(f.store.repairMarker(observed, async () => {})).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await readFile(f.markerPath)).toEqual(before);
  expect((await f.store.readForRepair())?.state.ownerGeneration).toBe(2);
});

it.each(["before-write", "lost-response"])(
  "preserves state across marker repair failure %s",
  async (point) => {
    const f = await fixture();
    await f.claim();
    const marker = JSON.parse(await readFile(f.markerPath, "utf8"));
    marker.status = "claiming";
    await writeFile(f.markerPath, JSON.stringify(marker));
    const stateBefore = await readFile(f.statePath);
    const expected = (await f.store.readForRepair())!;
    const original = (
      await vi.importActual<typeof import("./durable-host-json.js")>("./durable-host-json.js")
    ).writeDurableHostJson;
    vi.mocked(durable.writeDurableHostJson).mockImplementationOnce(async (...args) => {
      if (point === "lost-response") await original(...args);
      throw new Error("marker repair interrupted");
    });
    await expect(f.store.repairMarker(expected, async () => {})).rejects.toThrow(
      "marker repair interrupted",
    );
    vi.mocked(durable.writeDurableHostJson).mockImplementation(original);
    expect(await readFile(f.statePath)).toEqual(stateBefore);
    const after = (await f.store.readForRepair())!;
    expect(after.repairMarker).toBe(point === "lost-response" ? null : "active");
    if (point === "before-write") await f.store.repairMarker(after, async () => {});
    expect((await f.store.read())?.status).toBe("claimed");
    expect(await readFile(f.statePath)).toEqual(stateBefore);
  },
);

it.each([
  "consumption",
  "input",
  "history",
  "identity",
  "missing-state",
  "missing-marker",
  "corrupt",
  "root",
])("refuses marker repair for %s", async (kind) => {
  const f = await fixture();
  const state = await f.claim();
  if (kind === "consumption" || kind === "history") {
    await f.store.update(state.frozen.attemptId, 1, { kind: "consumption-intent" });
    if (kind === "history") await f.store.update(state.frozen.attemptId, 2, { kind: "abandoned" });
  }
  if (kind === "input")
    await f.store.update(state.frozen.attemptId, 1, {
      kind: "input",
      module: "probe",
      input: { public: "receipt" },
    });
  const marker = JSON.parse(await readFile(f.markerPath, "utf8"));
  marker.status = kind === "history" ? "active" : "claiming";
  if (kind === "identity") marker.attemptId = randomUUID();
  if (kind === "root") marker.stateDir = join(f.dir, "foreign");
  await writeFile(f.markerPath, JSON.stringify(marker));
  if (kind === "missing-state") await unlink(f.statePath);
  if (kind === "missing-marker") await unlink(f.markerPath);
  if (kind === "corrupt") await writeFile(f.statePath, "{");
  await expect(f.store.readForRepair()).rejects.toMatchObject({
    code: kind === "root" ? "setup.attempt_conflict" : "setup.attempt_invalid",
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

it("a retired root cannot be claimed again or accept a delayed state update", async () => {
  const f = await fixture();
  const state = await f.claim();
  const abandoned = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "abandoned",
  });
  await writeFile(join(f.options.venueDir, "first-setup-retirement.json"), "{}");
  const before = await readFile(f.statePath);
  await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  await expect(
    f.store.update(abandoned.frozen.attemptId, abandoned.revision, {
      kind: "recover",
      capabilityHash: digest("different"),
      claimNonceHash: digest("different-nonce"),
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await readFile(f.statePath)).toEqual(before);
});

async function retiredFixture() {
  const f = await fixture();
  const original = await f.claim();
  const api = await import("./index.js");
  const anchor = {
    stateDir: await realpath(f.options.stateDir),
    venueDir: await realpath(f.options.venueDir),
  };
  const resolutionId = randomUUID(),
    workspaceId = randomUUID(),
    base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    ...anchor,
    workspaceId,
    resolutionId,
    anchorStateDir: anchor.stateDir,
    anchorVenueDir: anchor.venueDir,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    selectionGeneration: 1,
  };
  const records = api.createFirstSetupResolutionStore({
    ...anchor,
    coordinator: api.createFirstSetupCoordinator(),
  });
  const prepared = await records.prepare(
    {
      resolutionId,
      attemptId: original.frozen.attemptId,
      observedRevision: 1,
      observedOwnerGeneration: 1,
      database: "missing",
      authority: "original-password",
      register: {
        kind: "current-master",
        status: "Unknown",
        custodian: "Elena",
        reference: "c".repeat(64),
        consultedAt: "2026-10-16T03:00:00.000Z",
      },
      action: "retire",
      nextWorkspace: binding,
    },
    [
      { name: "state/first-setup.json", bytes: await readFile(f.statePath) },
      { name: "venue/first-setup-claim.json", bytes: await readFile(f.markerPath) },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  await api.selectFirstSetupWorkspace(anchor, await records.apply(prepared));
  const fresh = api.createFirstSetupStore({
    ...binding,
    coordinator: api.createFirstSetupCoordinator(),
  });
  return { ...f, original, fresh, binding };
}
it.each(["attempt", "node", "administrator", "event"] as const)(
  "a selected workspace cannot reuse a retired %s identity",
  async (kind) => {
    const f = await retiredFixture(),
      input = frozen(),
      old = f.original.frozen;
    if (kind === "attempt") {
      input.attemptId = old.attemptId;
      input.sourceId = old.sourceId;
    } else if (kind === "node") input.nodeId = old.nodeId;
    else if (kind === "administrator") input.administratorId = old.administratorId;
    else input.modules[0]!.eventId = old.modules[0]!.eventId;
    await expect(
      f.fresh.claim(input, verifier, digest("new-capability"), digest("new-nonce")),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await f.fresh.read()).toBeNull();
    expect(await readFile(f.statePath, "utf8")).toBe(JSON.stringify(f.original));
  },
);
it("retirement exclusions allow fresh identities without copying the old account or settings", async () => {
  const f = await retiredFixture(),
    input = frozen();
  input.request.admin = {
    ...input.request.admin,
    email: "new@example.test",
    displayName: "New owner",
  };
  const state = await f.fresh.claim(input, verifier, digest("new-capability"), digest("new-nonce"));
  expect(state.frozen).toEqual(input);
  expect(state.previous).toEqual([]);
  expect(state.inputs).toEqual({});
  expect(state.revision).toBe(1);
});

it("a third workspace excludes identities from the original attempt after both retirements", async () => {
  const f = await retiredFixture(),
    api = await import("./index.js");
  const middle = await f.fresh.claim(
    frozen(),
    verifier,
    digest("middle-capability"),
    digest("middle-nonce"),
  );
  const anchor = { stateDir: f.binding.anchorStateDir, venueDir: f.binding.anchorVenueDir };
  const resolutionId = randomUUID(),
    workspaceId = randomUUID(),
    base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    ...f.binding,
    workspaceId,
    resolutionId,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    selectionGeneration: 2,
  };
  const records = api.createFirstSetupResolutionStore({
    ...anchor,
    coordinator: api.createFirstSetupCoordinator(),
  });
  const prepared = await records.prepare(
    {
      resolutionId,
      attemptId: middle.frozen.attemptId,
      observedRevision: middle.revision,
      observedOwnerGeneration: middle.ownerGeneration,
      database: "missing",
      authority: "original-password",
      register: {
        kind: "current-master",
        status: "Unknown",
        custodian: "Elena",
        reference: "d".repeat(64),
        consultedAt: "2026-10-16T04:00:00.000Z",
      },
      action: "retire",
      nextWorkspace: binding,
    },
    [
      {
        name: "workspace:predecessor",
        bytes: await readFile(join(f.binding.venueDir, "first-setup-workspace.json")),
      },
      {
        name: "state/first-setup.json",
        bytes: await readFile(join(f.binding.stateDir, "first-setup.json")),
      },
      {
        name: "venue/first-setup-claim.json",
        bytes: await readFile(join(f.binding.venueDir, "first-setup-claim.json")),
      },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  await api.selectFirstSetupWorkspace(anchor, await records.apply(prepared));
  const fresh = api.createFirstSetupStore({
    ...binding,
    coordinator: api.createFirstSetupCoordinator(),
  });
  const repeated = frozen();
  repeated.nodeId = f.original.frozen.nodeId;
  await expect(
    fresh.claim(repeated, verifier, digest("third-capability"), digest("third-nonce")),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(
    (await api.readRetiredFirstSetupStates(binding)).map((state) => state.frozen.attemptId),
  ).toEqual([middle.frozen.attemptId, f.original.frozen.attemptId]);
  expect(
    (await fresh.claim(frozen(), verifier, digest("third-capability"), digest("third-nonce")))
      .previous,
  ).toEqual([]);
});
