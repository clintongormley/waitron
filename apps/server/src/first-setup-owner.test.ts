import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  type VenueRequest,
} from "@waitron/provisioning";
import { verifyPassword, verifyPin } from "@waitron/identity";
import { createFirstSetupOwner, type FirstSetupClaimPayload } from "./first-setup-owner.js";
const dirs: string[] = [];
const payload: FirstSetupClaimPayload = {
  environment: "production",
  request: {
    country: "es",
    taxId: "b12345678",
    legalName: " Olivo SL ",
    taxpayerDomicile: "Calle Fiscal 1",
    location: {
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
    },
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
  const nonce = randomBytes(32).toString("base64url");
  const claim = () => owner.claimFirstSetup(structuredClone(payload), nonce);
  return {
    dir,
    options,
    store,
    owner,
    nonce,
    claim,
    tick: () => {
      now += 300001;
    },
  };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
  const persisted = await readFile(join(f.dir, "state", "first-setup.json"), "utf8");
  for (const secret of [payload.request.admin.password, claimed.capability, f.nonce])
    expect(persisted).not.toContain(secret);
});

it("recovers lost claim/resume responses with the same IDs and rotates every capability", async () => {
  const f = await fixture();
  const first = await f.claim();
  const resumed = await createFirstSetupOwner(f.options).resumeFirstSetup(f.nonce, {
    password: payload.request.admin.password,
  });
  const again = await f.owner.resumeFirstSetup(f.nonce, {
    password: payload.request.admin.password,
  });
  expect([first.state.attemptId, resumed.state.attemptId, again.state.attemptId]).toEqual(
    Array(3).fill(first.state.attemptId),
  );
  expect([first.ownerGeneration, resumed.ownerGeneration, again.ownerGeneration]).toEqual([
    1, 2, 3,
  ]);
  expect(new Set([first.capability, resumed.capability, again.capability]).size).toBe(3);
  expect(again.state.nodeId).toBe(first.state.nodeId);
  expect(again.state.administratorId).toBe(first.state.administratorId);
  for (const old of [first, resumed]) {
    await expect(
      f.owner.authorize({ ...old.state, capability: old.capability }),
    ).rejects.toMatchObject({ code: "setup.owner_required", params: {} });
  }
  await expect(
    f.owner.authorize({ ...again.state, capability: again.capability }),
  ).resolves.toMatchObject({ revision: 3 });
});

it.each(["nonce", "password"])(
  "refuses the wrong %s generically without a new event",
  async (wrong) => {
    const f = await fixture();
    const first = await f.claim();
    await expect(
      f.owner.resumeFirstSetup(
        wrong === "nonce" ? randomBytes(32).toString("base64url") : f.nonce,
        { password: wrong === "password" ? "WRONG-SECRET" : payload.request.admin.password },
      ),
    ).rejects.toMatchObject({ code: "setup.owner_required", params: {} });
    expect((await f.store.read())?.revision).toBe(first.state.revision);
    await expect(f.claim()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  },
);

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

it.each(["expired", "boot", "invalidated", "resumed"])(
  "invalidates reconfirmation when %s",
  async (why) => {
    const f = await fixture();
    const first = await f.claim();
    const owner = { ...first.state, capability: first.capability };
    const grant = await f.owner.reconfirm(owner, payload.request.admin.password, "activation");
    if (why === "expired") f.tick();
    if (why === "invalidated") f.owner.invalidate(owner.attemptId);
    if (why === "resumed")
      await f.owner.resumeFirstSetup(f.nonce, { password: payload.request.admin.password });
    const host =
      why === "boot" ? createFirstSetupOwner({ ...f.options, bootId: "boot-2" }) : f.owner;
    await expect(host.consumeReconfirmation(owner, grant, "activation")).rejects.toMatchObject({
      code: "setup.owner_required",
      params: {},
    });
  },
);

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

it.each(["restore-request.json", "reset-request.json", "incomplete-operation"])(
  "refuses %s before making a first claim",
  async (existing) => {
    const f = await fixture();
    if (existing === "incomplete-operation") {
      const { createSetupOperationStore } = await import("./setup-operation.js");
      await createSetupOperationStore(f.options.stateDir, "boot", {
        coordinator: f.options.coordinator,
      }).run("adopt", "old-request", async (operation) => {
        await operation.advance("venue_committed");
      });
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
  await createSetupOperationStore(f.options.stateDir, "boot", {
    coordinator: f.options.coordinator,
  }).run("import", "old-request", async (operation) => {
    await operation.complete();
  });
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
  const claiming = owner.claimFirstSetup(payload, f.nonce);
  release();
  await staging;
  await claiming;
  expect(frozeDuringStaging).toBe(false);
  expect((await f.store.read())?.frozen.configurationImport).toEqual({
    digest: "b".repeat(64),
    newTaxpayer: false,
  });
});
