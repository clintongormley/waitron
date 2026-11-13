import { dirname, join } from "node:path";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, createFirstSetupStore, type VenueRequest } from "./index.js";
import { verifyPassword, verifyPin } from "@waitron/identity";
import {
  createFirstSetupOwner,
  publicFirstSetupState,
  type FirstSetupClaimPayload,
} from "./first-setup-owner.js";
import * as filesystem from "node:fs/promises";
vi.mock("node:fs/promises", { spy: true });
const dirs: string[] = [];
const payload: FirstSetupClaimPayload = {
  environment: "production",
  request: {
    country: "es",
    taxId: "b12345678",
    legalName: " Olivo SL ",
    taxpayerDomicile: "Calle Fiscal 1",
    name: "Olivo",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurante",
    addressLine1: "Mayor 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    seriesCode: "A",
    fullSeriesCode: "F",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: " Elena ",
      email: "Elena@example.test ",
      password: "OWNER-SECRET-SENTINEL",
      pin: "4826",
    },
  },
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "first-owner-"));
  dirs.push(dir);
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({
    venueDir: join(dir, "venue"),
    stateDir: join(dir, "state"),
    coordinator,
  });
  let now = 1000;
  const options = {
    store,
    stateDir: join(dir, "state"),
    coordinator,
    bootId: "boot-1",
    now: () => now,
    freeze: async (
      request: VenueRequest,
      environment: "production" | "preproduction",
      ids: { attemptId: string; nodeId: string; administratorId: string },
    ) => ({ ...ids, sourceId: `first-setup:${ids.attemptId}`, request, environment, modules: [] }),
  };
  const owner = createFirstSetupOwner(options);
  const claim = () => owner.claimFirstSetup(structuredClone(payload));
  return {
    dir,
    options,
    store,
    owner,
    claim,
    tick: () => {
      now += 300001;
    },
  };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("the owner service offers no way to win a setup back with the password", async () => {
  const f = await fixture();
  for (const removed of [
    "recoverFirstSetupOwner",
    "resumeFirstSetup",
    "recoverFirstSetup",
    "withResolutionPassword",
  ])
    expect(f.owner).not.toHaveProperty(removed);
});

it("binds normalized planned identity, hashing both secrets and returning no verifiers/imports", async () => {
  const f = await fixture();
  const claimed = await f.claim();
  const state = (await f.store.read())!;
  expect(state.frozen.request.admin.email).toBe("elena@example.test");
  expect(state.frozen.request.admin.displayName).toBe("Elena");
  expect(state.frozen.request.country).toBe("ES");
  expect(state.frozen.request.taxId).toBe("B12345678");
  expect(await verifyPassword(payload.request.admin.password, state.ownerVerifier)).toBe(true);
  expect(await verifyPin(payload.request.admin.pin, state.frozen.request.admin.pinHash)).toBe(true);
  expect(claimed.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(claimed.state).not.toHaveProperty("ownerVerifier");
  expect(claimed.state).not.toHaveProperty("inputs");
  expect(claimed.state).not.toHaveProperty("request.admin.passwordHash");
  const persisted = await readFile(join(f.dir, "state", "flows/setup/record.json"), "utf8");
  for (const secret of [payload.request.admin.password, claimed.capability])
    expect(persisted).not.toContain(secret);
});

it("requires a current capability and password, binding one-use tokens to purpose and revision", async () => {
  const f = await fixture();
  const first = await f.claim();
  const owner = { ...first.state, capability: first.capability };
  await expect(f.owner.reconfirm(owner, "wrong", "block-use")).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  await expect(
    f.owner.reconfirm(
      { ...owner, capability: randomBytes(32).toString("base64url") },
      payload.request.admin.password,
      "block-use",
    ),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  const grant = await f.owner.reconfirm(owner, payload.request.admin.password, "block-use");
  await expect(f.owner.consumeReconfirmation(owner, grant, "block-use")).resolves.toBeUndefined();
  await expect(f.owner.consumeReconfirmation(owner, grant, "block-use")).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  const separate = await f.owner.reconfirm(owner, payload.request.admin.password, "block-use");
  await expect(f.owner.consumeReconfirmation(owner, separate, "activation")).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  const stale = await f.owner.reconfirm(owner, payload.request.admin.password, "activation");
  await f.store.update(owner.attemptId, owner.revision, { kind: "consumption-intent" });
  await expect(
    f.owner.consumeReconfirmation({ ...owner, revision: 2 }, stale, "activation"),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
});

it.each(["expired", "boot", "invalidated"])("invalidates reconfirmation when %s", async (why) => {
  const f = await fixture();
  const first = await f.claim();
  const owner = { ...first.state, capability: first.capability };
  const grant = await f.owner.reconfirm(owner, payload.request.admin.password, "activation");
  if (why === "expired") f.tick();
  if (why === "invalidated") f.owner.invalidate(owner.attemptId);
  const host = why === "boot" ? createFirstSetupOwner({ ...f.options, bootId: "boot-2" }) : f.owner;
  await expect(host.consumeReconfirmation(owner, grant, "activation")).rejects.toMatchObject({
    code: "setup.owner_required",
    params: {},
  });
});

it("expires after five elapsed minutes even if the wall clock moves backwards", async () => {
  const f = await fixture();
  const first = await f.claim();
  const owner = { ...first.state, capability: first.capability };
  vi.useFakeTimers({ toFake: ["performance", "Date"] });
  try {
    const host = createFirstSetupOwner({ ...f.options, now: undefined });
    const grant = await host.reconfirm(owner, payload.request.admin.password, "activation");
    const wall = Date.now();
    await vi.advanceTimersByTimeAsync(300001);
    vi.setSystemTime(wall - 3600000);
    await expect(host.consumeReconfirmation(owner, grant, "activation")).rejects.toMatchObject({
      code: "setup.owner_required",
    });
  } finally {
    vi.useRealTimers();
  }
});

it.each(["staged", "placing", "reset-request.json", "incomplete-operation"])(
  "refuses %s before making a first claim",
  async (existing) => {
    const f = await fixture();
    if (existing === "incomplete-operation") {
      const { createSetupOperationStore } = await import("./setup-operation.js");
      await createSetupOperationStore(f.options.stateDir, {
        coordinator: f.options.coordinator,
      }).run("adopt", "old-request", async (operation) => {
        await operation.advance("venue_committed");
      });
    } else if (existing === "staged" || existing === "placing") {
      await mkdir(join(f.options.stateDir, "flows/restore"), { recursive: true });
      await writeFile(
        join(f.options.stateDir, "flows/restore/record.json"),
        JSON.stringify({ version: 1, phase: existing }),
      );
    } else {
      await mkdir(f.options.stateDir, { recursive: true });
      await writeFile(join(f.options.stateDir, existing), "{unresolved");
    }
    await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_conflict", params: {} });
    expect(await f.store.read()).toBeNull();
  },
);

it("permits a claim after an unrelated operation is durably complete", async () => {
  const f = await fixture();
  const { createSetupOperationStore } = await import("./setup-operation.js");
  await createSetupOperationStore(f.options.stateDir, {
    coordinator: f.options.coordinator,
  }).run("import", "old-request", async (operation) => {
    await operation.complete();
  });
  await mkdir(join(f.options.stateDir, "flows/restore"), { recursive: true });
  await writeFile(
    join(f.options.stateDir, "flows/restore/record.json"),
    JSON.stringify({ version: 1, phase: "first-start", firstStart: { source: "archive" } }),
  );
  await expect(f.claim()).resolves.toMatchObject({ ownerGeneration: 1 });
});

it("freezes the selected staged file only after earlier setup work releases the common coordinator", async () => {
  const f = await fixture();
  const path = join(f.dir, "staged-digest");
  await writeFile(path, "a".repeat(64));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let stagingActive = true,
    frozeDuringStaging = false;
  const staging = f.options.coordinator.run(async () => {
    entered();
    await pending;
    await writeFile(path, "b".repeat(64));
    stagingActive = false;
  });
  await started;
  const owner = createFirstSetupOwner({
    ...f.options,
    freeze: async (...args) => {
      frozeDuringStaging = stagingActive;
      return {
        ...(await f.options.freeze(args[0], args[1], args[2])),
        configurationImport: { digest: await readFile(path, "utf8"), newTaxpayer: false },
      };
    },
  });
  const claiming = owner.claimFirstSetup(payload);
  release();
  await staging;
  await claiming;
  expect(frozeDuringStaging).toBe(false);
  expect((await f.store.read())?.frozen.configurationImport).toEqual({
    digest: "b".repeat(64),
    newTaxpayer: false,
  });
});

it("refuses a second claim over the attempt it already holds, leaving its revision alone", async () => {
  const f = await fixture();
  const first = await f.claim();
  await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.store.read())?.revision).toBe(first.state.revision);
});

it("an abandoned attempt refuses owner writes but still answers its status", async () => {
  const f = await fixture();
  const first = await f.claim();
  await f.store.update(first.state.attemptId, 1, { kind: "abandoned" });
  const owner = { ...first.state, revision: 2, capability: first.capability };
  await expect(f.owner.authorize(owner)).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(f.owner.status(owner)).resolves.toMatchObject({ status: "abandoned" });
});

it("keeps a completed attempt out of a new activation", async () => {
  const f = await fixture();
  const claim = await f.claim();
  let state = (await f.store.read())!;
  for (const change of [
    { kind: "consumption-intent" },
    { kind: "activation-started" },
    { kind: "committed", result: { retained: "original-result" } },
    { kind: "publication" },
    { kind: "complete" },
  ] as const)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  const bytes = await readFile(join(f.dir, "state", "flows/setup/record.json"));
  const refusal = { owner: "setup.owner_required", store: "setup.attempt_conflict" };
  await expect(
    f.owner.authorize({ ...claim.state, revision: state.revision, capability: claim.capability }),
  ).rejects.toMatchObject({ code: refusal.owner });
  await expect(
    f.store.update(state.frozen.attemptId, state.revision, { kind: "activation-started" }),
  ).rejects.toMatchObject({ code: refusal.store });
  expect(await readFile(join(f.dir, "state", "flows/setup/record.json"))).toEqual(bytes);
  expect((await f.store.readResumable())?.state.result).toEqual({
    retained: "original-result",
  });
});

it("polls the latest revision with the current capability while refusing stale writes", async () => {
  const f = await fixture();
  const claimed = await f.claim();
  const owner = { ...claimed.state, capability: claimed.capability };
  const consumed = await f.store.update(owner.attemptId, owner.revision, {
    kind: "consumption-intent",
  });
  await expect(f.owner.status(owner)).resolves.toMatchObject({
    revision: 2,
    status: "consumption-intent",
  });
  expect(publicFirstSetupState(await f.owner.status(owner))).toMatchObject({
    status: "consumption-intent",
    consumptionIntent: true,
  });
  await expect(f.owner.authorize(owner)).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(
    f.owner.status({ ...owner, capability: randomBytes(32).toString("base64url") }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect((await f.store.read())?.revision).toBe(2);
  expect(await f.store.read()).toEqual(consumed);
});

it.each(["password-type", "pin-type", "password-size", "pin-size"])(
  "refuses malformed %s before creating an ownership record",
  async (kind) => {
    const f = await fixture();
    const proposed = structuredClone(payload);
    if (kind === "password-type") proposed.request.admin.password = null as unknown as string;
    if (kind === "pin-type") proposed.request.admin.pin = null as unknown as string;
    if (kind === "password-size") proposed.request.admin.password = "x".repeat(1025);
    if (kind === "pin-size") proposed.request.admin.pin = "1".repeat(1025);
    await expect(f.owner.claimFirstSetup(proposed)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    expect(await f.store.read()).toBeNull();
  },
);

it.each(["attemptId", "nodeId", "administratorId", "environment"] as const)(
  "refuses a frozen claim that changes its %s before retaining it",
  async (field) => {
    const f = await fixture();
    const owner = createFirstSetupOwner({
      ...f.options,
      freeze: async (...args: Parameters<typeof f.options.freeze>) => ({
        ...(await f.options.freeze(...args)),
        [field]: field === "environment" ? "preproduction" : "changed-id",
      }),
    });
    await expect(owner.claimFirstSetup(structuredClone(payload))).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
    expect(await f.store.read()).toBeNull();
  },
);

it("refuses ownership lookups without a claim and never invents one", async () => {
  const f = await fixture();
  const owner = {
    attemptId: "missing",
    revision: 1,
    ownerGeneration: 1,
    capability: randomBytes(32).toString("base64url"),
  };
  await expect(f.owner.authorize(owner)).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(f.owner.status(owner)).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await f.store.read()).toBeNull();
});
it("rejects unsupported reconfirmation purposes and malformed one-use grants", async () => {
  const f = await fixture();
  const claim = await f.claim();
  const owner = { ...claim.state, capability: claim.capability };
  await expect(
    f.owner.reconfirm(owner, payload.request.admin.password, "other" as "activation"),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(f.owner.consumeReconfirmation(owner, "bad", "activation")).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect((await f.store.read())?.revision).toBe(1);
});

it("does not claim over an unreadable operation or filesystem entry", async () => {
  const f = await fixture();
  await mkdir(f.options.stateDir);
  const operation = join(f.options.stateDir, "flows/setup/operation.json");
  await mkdir(dirname(operation), { recursive: true });
  await writeFile(operation, "not JSON");
  await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await rm(operation);
  await mkdir(dirname(operation), { recursive: true });
  await writeFile(operation, "{}");
  const spy = vi.spyOn(filesystem, "lstat").mockRejectedValueOnce(new Error("unreadable state"));
  try {
    await rm(operation);
    await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  } finally {
    spy.mockRestore();
  }
  expect(await f.store.read()).toBeNull();
});

it("returns selected module names and versions without their frozen private requests", async () => {
  const f = await fixture();
  const owner = createFirstSetupOwner({
    ...f.options,
    freeze: async (...args: Parameters<typeof f.options.freeze>) => ({
      ...(await f.options.freeze(...args)),
      modules: [
        { module: "test-regime", version: "1.0.0", eventId: args[2].attemptId, request: null },
      ],
    }),
  });
  const claim = await owner.claimFirstSetup(structuredClone(payload));
  expect(claim.state.modules).toEqual([{ module: "test-regime", version: "1.0.0" }]);
  expect(claim.state).not.toHaveProperty("inputs");
});
