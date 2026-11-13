import { readSetupFlowRecord, updateSetupFlowSection } from "@waitron/provisioning";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { firstFiscalFixture, MODULE, PASSWORD } from "../test/first-fiscal.js";
import { historicalFirstFiscalDocuments } from "../test/historical-first-fiscal.js";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { createFirstFiscalEvidence } from "./first-fiscal-evidence.js";

const fixtures: Awaited<ReturnType<typeof firstFiscalFixture>>[] = [];
async function fixture() {
  const f = await firstFiscalFixture();
  fixtures.push(f);
  const options = {
    ...f,
    modules: historicalFirstFiscalDocuments(f.modules),
    bootId: "boot-1",
  };
  const evidence = createFirstFiscalEvidence(options);
  const enrol = () => evidence.enrol(f.ownerAttempt, MODULE, f.key, f.key.fingerprint);
  const confirm = async (statement: unknown = f.current) => {
    const token = await f.owner.reconfirm(f.ownerAttempt, PASSWORD, "activation");
    return evidence.confirm(f.ownerAttempt, MODULE, statement, token);
  };
  return {
    ...f,
    options,
    evidence,
    enrol,
    confirm,
    path: join(f.stateDir, "flows/setup/record.json"),
  };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
const missing = {
  code: "sif.allocation_invalid",
  params: { reason: "outside_confirmation_missing" },
};
it("keeps a signed upload separate from independently enrolled trust and fresh one-use consultation", async () => {
  const f = await fixture();
  await expect(f.evidence.read(f.context.binding)).rejects.toMatchObject(missing);
  await expect(f.confirm()).rejects.toMatchObject(missing);
  await f.enrol();
  await expect(f.evidence.read(f.context.binding)).rejects.toMatchObject(missing);
  await f.confirm();
  await expect(f.evidence.read(f.context.binding)).resolves.toEqual({
    trust: f.key,
    current: f.current,
  });
  await expect(f.evidence.read(f.context.binding)).rejects.toMatchObject(missing);
  const persisted = await readFile(f.path, "utf8");
  expect(persisted).toContain("master/event1");
  expect(persisted).not.toContain(PASSWORD);
  expect(persisted).not.toContain(f.ownerAttempt.capability);
  expect(persisted).not.toContain("PRIVATE KEY");
});
it.each(["trust", "currentRegisterConfirmed", "privateKey"])(
  "refuses embedded %s at enrolment",
  async (field) => {
    const f = await fixture();
    await expect(
      f.evidence.enrol(f.ownerAttempt, MODULE, { ...f.key, [field]: true }, f.key.fingerprint),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect((await readSetupFlowRecord(f.stateDir))?.publicEvidence).toBeUndefined();
  },
);
it("refuses a fingerprint mismatch and a foreign owner before writing trust", async () => {
  const f = await fixture();
  await expect(
    f.evidence.enrol(f.ownerAttempt, MODULE, f.key, "0".repeat(64)),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  await expect(
    f.evidence.enrol(
      { ...f.ownerAttempt, capability: "x".repeat(43) },
      MODULE,
      f.key,
      f.key.fingerprint,
    ),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect((await readSetupFlowRecord(f.stateDir))?.publicEvidence).toBeUndefined();
});
it.each([
  ["allocationId", "other"],
  ["operatorId", "other"],
  ["recipientVenueId", "other"],
  ["generationId", "other"],
  ["blockId", "other"],
  ["incidentEvidence", "other"],
  ["requiredBases", [{ code: "A", purpose: "full" }]],
  ["binding", {}],
  ["currentRegisterConfirmed", false],
  ["consumptionConfirmed", false],
  ["currentEntryState", "reserved"],
  ["priorActivation", "uncertain"],
  ["trust", {}],
])("refuses a mismatched current statement %s", async (field, value) => {
  const f = await fixture();
  await f.enrol();
  await expect(f.confirm({ ...f.current, [field as string]: value })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
  });
  await expect(f.evidence.read(f.context.binding)).rejects.toMatchObject(missing);
});
it.each(["restart", "invalidate", "revision", "expired"])(
  "cannot reuse current evidence after %s",
  async (why) => {
    const f = await fixture();
    await f.enrol();
    vi.useFakeTimers({ toFake: ["performance", "Date"] });
    await f.confirm();
    let evidence = f.evidence;
    if (why === "restart")
      evidence = createFirstFiscalEvidence({
        ...f.options,
        bootId: "boot-2",
        owner: createFirstSetupOwner({ ...f.ownerOptions, bootId: "boot-2" }),
      });
    if (why === "invalidate") evidence.invalidate(f.context.attemptId);
    if (why === "revision")
      await f.store.update(f.context.attemptId, f.ownerAttempt.revision, {
        kind: "activation-started",
      });
    if (why === "expired") {
      await vi.advanceTimersByTimeAsync(300001);
      vi.setSystemTime(0);
    }
    await expect(evidence.read(f.context.binding)).rejects.toMatchObject(missing);
  },
);
it.each(["missing", "corrupt", "replaced", "oversize"])(
  "rereads %s enrolled trust without fallback",
  async (why) => {
    const f = await fixture();
    await f.enrol();
    await f.confirm();
    if (why === "missing")
      await updateSetupFlowSection(f.stateDir, "publicEvidence", () => undefined);
    if (why === "corrupt") await updateSetupFlowSection(f.stateDir, "publicEvidence", () => "{bad");
    if (why === "replaced") {
      const data = JSON.parse(
        JSON.stringify((await readSetupFlowRecord(f.stateDir))!.publicEvidence),
      );
      data.modules[MODULE].comparison = "0".repeat(64);
      await updateSetupFlowSection(f.stateDir, "publicEvidence", () => data);
    }
    if (why === "oversize")
      await updateSetupFlowSection(f.stateDir, "publicEvidence", () => " ".repeat(65537));
    await expect(f.evidence.read(f.context.binding)).rejects.toMatchObject({
      code: expect.stringMatching(/setup.attempt_invalid|sif.allocation_invalid/),
    });
    await expect(f.evidence.read(f.context.binding)).rejects.toMatchObject(missing);
  },
);
it("retains enrolment across restart but needs new owner/password/current consultation", async () => {
  const f = await fixture();
  await f.enrol();
  await f.confirm();
  const owner = createFirstSetupOwner({ ...f.ownerOptions, bootId: "boot-2" });
  const evidence = createFirstFiscalEvidence({ ...f.options, bootId: "boot-2", owner });
  const token = await owner.reconfirm(f.ownerAttempt, PASSWORD, "activation");
  await evidence.confirm(f.ownerAttempt, MODULE, f.current, token);
  await expect(evidence.read(f.context.binding)).resolves.toEqual({
    trust: f.key,
    current: f.current,
  });
});
it("requires activation-purpose reconfirmation and burns the current grant before parallel reads", async () => {
  const f = await fixture();
  await f.enrol();
  const token = await f.owner.reconfirm(f.ownerAttempt, PASSWORD, "block-use");
  await expect(f.evidence.confirm(f.ownerAttempt, MODULE, f.current, token)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  await f.confirm();
  const outcomes = await Promise.allSettled([
    f.evidence.read(f.context.binding),
    f.evidence.read(f.context.binding),
  ]);
  expect(outcomes.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
});

it("refuses a consultation that expires while its durable evidence is being read", async () => {
  const f = await fixture();
  await f.enrol();
  vi.useFakeTimers({ toFake: ["performance", "Date"] });
  await f.confirm();
  const read = f.store.read.bind(f.store);
  let reads = 0;
  const spy = vi.spyOn(f.store, "read").mockImplementation(async () => {
    const result = await read();
    if (++reads === 2) await vi.advanceTimersByTimeAsync(300001);
    return result;
  });
  try {
    await expect(f.evidence.read(f.context.binding)).rejects.toMatchObject(missing);
  } finally {
    spy.mockRestore();
  }
});

it.each([
  ["unsupported version", { version: 2, modules: {}, history: [] }],
  ["extra field", { version: 1, modules: {}, history: [], currentRegisterConfirmed: true }],
  ["module array", { version: 1, modules: [], history: [] }],
  ["missing history", { version: 1, modules: {} }],
  ["history object", { version: 1, modules: {}, history: {} }],
  ["invalid module name", { version: 1, modules: { INVALID: {} }, history: [] }],
  ["missing enrolment fields", { version: 1, modules: { valid: {} }, history: [] }],
  [
    "non-string attempt",
    {
      version: 1,
      modules: { valid: { attemptId: 1, publicKey: {}, comparison: {}, trust: {} } },
      history: [],
    },
  ],
  ["missing audit fields", { version: 1, modules: {}, history: [{}] }],
  [
    "non-string audit attempt",
    {
      version: 1,
      modules: {},
      history: [{ attemptId: 1, revision: 1, ownerGeneration: 1, module: MODULE, current: {} }],
    },
  ],
  [
    "non-string audit module",
    {
      version: 1,
      modules: {},
      history: [
        { attemptId: "attempt", revision: 1, ownerGeneration: 1, module: null, current: {} },
      ],
    },
  ],
  [
    "fractional audit revision",
    {
      version: 1,
      modules: {},
      history: [
        { attemptId: "attempt", revision: 1.5, ownerGeneration: 1, module: MODULE, current: {} },
      ],
    },
  ],
  [
    "fractional audit generation",
    {
      version: 1,
      modules: {},
      history: [
        { attemptId: "attempt", revision: 1, ownerGeneration: 1.5, module: MODULE, current: {} },
      ],
    },
  ],
])("refuses %s in durable enrolment rather than overwriting it", async (_label, data) => {
  const f = await fixture();
  const text = JSON.stringify(data);
  await updateSetupFlowSection(f.stateDir, "publicEvidence", () => data);
  await expect(f.enrol()).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(JSON.stringify((await readSetupFlowRecord(f.stateDir))?.publicEvidence)).toBe(text);
});
it.each(["attempt", "trust"])(
  "checks the retained enrolment's %s again on consultation",
  async (why) => {
    const f = await fixture();
    await f.enrol();
    const data = JSON.parse(
      JSON.stringify((await readSetupFlowRecord(f.stateDir))!.publicEvidence),
    );
    if (why === "attempt") data.modules[MODULE].attemptId = "other";
    else data.modules[MODULE].trust.fingerprint = "0".repeat(64);
    await updateSetupFlowSection(f.stateDir, "publicEvidence", () => data);
    await expect(f.confirm()).rejects.toMatchObject(missing);
  },
);
it.each(["absent", "version", "seat", "unselected"])(
  "refuses a %s module rather than collecting with another offering",
  async (why) => {
    const f = await fixture();
    const modules =
      why === "absent"
        ? f.modules.filter((m) => m.name !== MODULE)
        : f.modules.map((m) =>
            m.name !== MODULE
              ? m
              : why === "version"
                ? { ...m, version: "other" }
                : { ...m, provisioning: { ...m.provisioning, initialSetup: undefined } },
          );
    const evidence = createFirstFiscalEvidence({ ...f.options, modules });
    await expect(
      evidence.enrol(
        f.ownerAttempt,
        why === "unselected" ? "fiscal-none" : MODULE,
        f.key,
        f.key.fingerprint,
      ),
    ).rejects.toMatchObject(missing);
  },
);
it("does not create an activation grant before consumption intent", async () => {
  const f = await fixture();
  await f.enrol();
  const path = join(f.stateDir, "flows/setup/record.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.attempt.history.pop();
  saved.attempt.revision--;
  saved.attempt.status = "claimed";
  saved.attempt.consumptionIntent = false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(saved));
  const owner = { ...f.ownerAttempt, revision: saved.attempt.revision };
  const token = await f.owner.reconfirm(owner, PASSWORD, "activation");
  await expect(f.evidence.confirm(owner, MODULE, f.current, token)).rejects.toMatchObject(missing);
});
it("uses no outside evidence for an ordinary non-setup operation or an unclaimed host", async () => {
  const f = await fixture();
  await expect(
    f.evidence.read({ ...f.context.binding, action: "restore" }),
  ).resolves.toBeUndefined();
  const { createFirstSetupStore } = await import("@waitron/provisioning");
  const store = createFirstSetupStore({
    stateDir: join(f.root, "unclaimed-state"),
    venueDir: join(f.root, "unclaimed-venue"),
    coordinator: f.coordinator,
  });
  await expect(
    createFirstFiscalEvidence({ ...f.options, store }).read(f.context.binding),
  ).resolves.toBeUndefined();
});
it.each(["wrong binding", "changed input", "abandoned", "uncertain", "complete"])(
  "refuses a previously valid grant after %s",
  async (why) => {
    const f = await fixture();
    await f.enrol();
    await f.confirm();
    let binding = f.context.binding;
    if (why === "wrong binding") binding = { ...binding, targetNodeId: "another-node" };
    if (why === "changed input") {
      const path = join(f.stateDir, "flows/setup/record.json");
      const state = JSON.parse(await readFile(path, "utf8"));
      state.attempt.inputs[MODULE].approval.incidentEvidence = "other";
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(state));
    }
    if (["abandoned", "uncertain", "complete"].includes(why)) {
      let state = (await f.store.read())!;
      const kinds =
        why === "complete"
          ? (["activation-started", "committed", "publication", "complete"] as const)
          : [why as "abandoned" | "uncertain"];
      for (const kind of kinds)
        state = await f.store.update(
          f.context.attemptId,
          state.revision,
          kind === "committed" ? { kind, result: { public: true } } : { kind },
        );
    }
    await expect(f.evidence.read(binding)).rejects.toMatchObject(missing);
  },
);
it("participates in an already held complete callback without queueing itself", async () => {
  const f = await fixture();
  await f.coordinator.run(async (hold) => {
    await f.evidence.enrol(f.ownerAttempt, MODULE, f.key, f.key.fingerprint, hold);
  });
  const token = await f.owner.reconfirm(f.ownerAttempt, PASSWORD, "activation");
  await f.coordinator.run(async (hold) => {
    await f.evidence.confirm(f.ownerAttempt, MODULE, f.current, token, hold);
    expect(await f.evidence.read(f.context.binding)).toEqual({ trust: f.key, current: f.current });
  });
});

it("stores enrolled evidence inside the setup record", async () => {
  const f = await fixture();
  await f.enrol();
  expect((await readSetupFlowRecord(f.stateDir))?.publicEvidence).toMatchObject({
    version: 1,
    modules: { [MODULE]: { attemptId: f.ownerAttempt.attemptId } },
    history: [],
  });
});
