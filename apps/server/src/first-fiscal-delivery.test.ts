import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi } from "vitest";
import { declaredFirstFiscalFixture, publicDigest } from "../test/declared-first-fiscal.js";
import { createFirstSetupNodeKeys } from "./first-setup-node-key.js";
import { createFirstFiscalDelivery } from "./first-fiscal-delivery.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { historicalFirstFiscalDocuments } from "../test/historical-first-fiscal.js";
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const now = Date.now(),
      mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: now,
      uncertaintyMs: 500,
      wallStartedMs: now,
      wallFinishedMs: now,
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const fixtures: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture() {
  const f = await declaredFirstFiscalFixture();
  fixtures.push(f);
  const keys = createFirstSetupNodeKeys(f);
  const staged = await keys.stageInitialNodeKey(
    f.ownerAttempt,
    await f.owner.reconfirm(f.ownerAttempt, f.password, "block-use"),
  );
  const delivery = createFirstFiscalDelivery({
    ...f,
    keys,
    modules: historicalFirstFiscalDocuments(f.modules),
  });
  const input = {
    module: f.module,
    stageId: staged.stage.stageId,
    inputDigest: publicDigest(f.input),
    historyDigest: f.statement.delivery.historyDigest,
    documentDigest: f.statement.delivery.documentDigest,
    statement: f.statement,
  };
  const register = () => delivery.registerFirstFiscalDelivery(f.ownerAttempt, input);
  const kept = async (change: Record<string, unknown> = {}) =>
    delivery.confirmFirstFiscalDocumentKept(
      f.ownerAttempt,
      {
        module: f.module,
        stageId: input.stageId,
        inputDigest: input.inputDigest,
        historyDigest: input.historyDigest,
        documentDigest: input.documentDigest,
        kept: true,
        ...change,
      },
      await f.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
    );
  return { ...f, keys, staged, delivery, input, register, kept };
}
const missing = {
  code: "sif.allocation_invalid",
  params: { reason: "outside_confirmation_missing" },
};
it("requires registration and explicit kept confirmation before issuing one bound grant", async () => {
  const f = await fixture();
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
  await expect(f.kept()).rejects.toMatchObject(missing);
  await f.register();
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
  await f.kept();
  expect(await f.delivery.read(f.context.binding)).toEqual({ trust: null, current: f.statement });
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
  const files = await readdir(join(f.stateDir, "first-fiscal-documents"));
  const data = (
    await Promise.all(
      files.map((p) => readFile(join(f.stateDir, "first-fiscal-documents", p), "utf8")),
    )
  ).join("");
  expect(data).not.toContain(f.staged.key.secret);
  expect(data).not.toContain(f.ownerAttempt.capability);
  expect(data).not.toContain(f.password);
  expect(data).not.toContain("%PDF");
});
it.each(["stageId", "inputDigest", "historyDigest", "documentDigest", "module"])(
  "rejects a mismatched %s at kept confirmation",
  async (field) => {
    const f = await fixture();
    await f.register();
    await expect(f.kept({ [field]: "other" })).rejects.toMatchObject(missing);
    await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
  },
);
it.each(["stageId", "inputDigest", "historyDigest", "documentDigest"])(
  "rejects a mismatched %s at registration",
  async (field) => {
    const f = await fixture();
    await expect(
      f.delivery.registerFirstFiscalDelivery(f.ownerAttempt, {
        ...f.input,
        [field]: "b".repeat(64),
      }),
    ).rejects.toMatchObject(missing);
  },
);
it("a download or print event alone supplies no kept-document grant", async () => {
  const f = await fixture();
  await f.register();
  await expect(f.kept({ kept: false })).rejects.toMatchObject(missing);
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
});
it.each(["expiry", "restart", "revision", "owner generation", "invalidate"])(
  "refuses a previously valid document after %s",
  async (why) => {
    const f = await fixture();
    await f.register();
    vi.useFakeTimers({ toFake: ["performance"] });
    await f.kept();
    let delivery = f.delivery;
    if (why === "expiry") await vi.advanceTimersByTimeAsync(300001);
    if (why === "restart")
      delivery = createFirstFiscalDelivery({ ...f, keys: f.keys, bootId: "boot-2" });
    if (why === "revision")
      await f.store.update(f.ownerAttempt.attemptId, f.ownerAttempt.revision, {
        kind: "activation-started",
      });
    if (why === "owner generation")
      await f.owner.resumeFirstSetup(f.nonce, { password: f.password });
    if (why === "invalidate") f.delivery.invalidate(f.ownerAttempt.attemptId);
    await expect(delivery.read(f.context.binding)).rejects.toMatchObject(missing);
  },
);
it("binds the consumed successor rather than accepting an unconsumed statement", async () => {
  const f = await fixture();
  const history = {
    ...f.statement.history,
    revisions: f.statement.history.revisions.map((r) => ({ ...r, events: r.events.slice(0, -1) })),
  };
  const historyDigest = publicDigest(history);
  const statement = {
    ...f.statement,
    history,
    delivery: { ...f.statement.delivery, historyDigest },
  };
  await expect(
    f.delivery.registerFirstFiscalDelivery(f.ownerAttempt, {
      ...f.input,
      historyDigest,
      statement,
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
});
it("a changed public history or stage on disk invalidates the grant", async () => {
  const f = await fixture();
  await f.register();
  await f.kept();
  const path = join(f.stateDir, "first-setup-node-key.json"),
    stage = JSON.parse(await readFile(path, "utf8"));
  stage.name = "2026-10-16 · 3333";
  await writeFile(path, JSON.stringify(stage));
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
});
it("consumes a grant before concurrent readers can both prepare", async () => {
  const f = await fixture();
  await f.register();
  await f.kept();
  const results = await Promise.allSettled([
    f.delivery.read(f.context.binding),
    f.delivery.read(f.context.binding),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
});
it("rereads finalized public chunks and refuses tampering", async () => {
  const f = await fixture();
  await f.register();
  await f.kept();
  const root = join(f.stateDir, "first-fiscal-documents");
  const file = (await readdir(root)).find((p) => p.endsWith("-0.json"))!;
  const path = join(root, file),
    chunk = JSON.parse(await readFile(path, "utf8"));
  const original = Buffer.from(chunk.data, "base64").toString("utf8");
  const changed = original.replace('"confirmedAt":"2026', '"confirmedAt":"2025');
  expect(changed).not.toBe(original);
  expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
  chunk.data = Buffer.from(changed).toString("base64");
  await writeFile(path, JSON.stringify(chunk));
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject({
    code: expect.stringMatching(/setup.attempt_invalid|sif.allocation_invalid/),
  });
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
});
it("a committed retry reuses the retained document and key with fresh owner authority", async () => {
  const f = await fixture();
  await f.register();
  await f.kept();
  await f.delivery.read(f.context.binding);
  let state = (await f.store.read())!;
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "activation-started",
  });
  await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "committed",
    result: { venue: { nodeId: state.frozen.nodeId }, modules: {} },
  });
  const resumed = await f.owner.resumeFirstSetup(f.nonce, { password: f.password });
  const owner = {
    ...f.ownerAttempt,
    revision: resumed.state.revision,
    ownerGeneration: resumed.ownerGeneration,
    capability: resumed.capability,
  };
  const statement = { ...f.statement, priorActivation: "committed" as const };
  await f.delivery.registerFirstFiscalDelivery(owner, { ...f.input, statement });
  const { statement: _, ...reference } = f.input;
  void _;
  await f.delivery.confirmFirstFiscalDocumentKept(
    owner,
    { ...reference, kept: true },
    await f.owner.reconfirm(owner, f.password, "activation"),
  );
  expect(await f.delivery.read(f.context.binding)).toEqual({ trust: null, current: statement });
  expect(await f.keys.readStage(owner)).toEqual(f.staged.stage);
});
it("duplicate confirmation consumes its password grant rather than creating another activation grant", async () => {
  const f = await fixture();
  await f.register();
  const nonce = await f.owner.reconfirm(f.ownerAttempt, f.password, "activation");
  const { statement: _, ...reference } = f.input;
  void _;
  await f.delivery.confirmFirstFiscalDocumentKept(
    f.ownerAttempt,
    { ...reference, kept: true },
    nonce,
  );
  await expect(
    f.delivery.confirmFirstFiscalDocumentKept(f.ownerAttempt, { ...reference, kept: true }, nonce),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject(missing);
});
it("an interrupted public-chunk write cannot publish or grant an incomplete history", async () => {
  const f = await fixture();
  await f.register();
  const folder = join(f.stateDir, "first-fiscal-documents");
  const manifest = join(folder, `${f.module}.json`);
  const data = JSON.parse(await readFile(manifest, "utf8"));
  data.chunks++;
  await writeFile(manifest, JSON.stringify(data));
  await expect(f.kept()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(f.delivery.read(f.context.binding)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});
describe("configured hour delivery", () => {
  const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
  it("the configured host routes the kept-document grant into real module preparation", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
    const f = await hourFirstFiscalFixture({ database: () => venue.db });
    fixtures.push(f);
    const { withOperationAuthority, withPreparedModuleOperations } =
      await import("@waitron/module");
    const host = f.host;
    const prepare = () =>
      host.coordinator.run(async (hold) => {
        await host.recoveryDelivery.consume(f.ownerAttempt, f.module, hold);
        return withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
          withPreparedModuleOperations(
            host.modules,
            new Map([[f.module, { binding: f.context.binding, authority, input: f.input }]]),
            f.context.binding.targetNodeId,
            "setup",
            async (ready) => ready.has(f.module),
          ),
        );
      });
    await expect(prepare()).resolves.toBe(true);
    await expect(prepare()).rejects.toMatchObject({ code: "setup.not_ready", params: {} });
  });
});
it("keeps a public history larger than the legacy grant file in separately bounded chunks", async () => {
  const f = await fixture();
  const { createHash } = await import("node:crypto");
  const bytes = Buffer.from(
    JSON.stringify({
      payload: { synthetic: "x".repeat(100000) },
      keyId: "a".repeat(64),
      signature: "A".repeat(86),
    }),
  );
  const original = {
    kind: "cloud-receipt" as const,
    bytesBase64url: bytes.toString("base64url"),
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
  const history = { ...f.statement.history, originals: [original] };
  const historyDigest = publicDigest(history);
  const proof = {
    ...(f.input.statement.input.allocation.reservationEvidence as object),
    historyDigest,
  };
  const input = {
    ...f.statement.input,
    allocation: { ...f.statement.input.allocation, reservationEvidence: proof },
  };
  const statement = {
    ...f.statement,
    history,
    input,
    delivery: { ...f.statement.delivery, historyDigest },
  };
  // This fixture imports a larger valid input before the immutable delivery is registered.
  const path = join(f.stateDir, "first-setup.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.inputs[f.module] = input;
  await writeFile(path, JSON.stringify(saved));
  const deliveryInput = { ...f.input, statement, inputDigest: publicDigest(input), historyDigest };
  await f.delivery.registerFirstFiscalDelivery(f.ownerAttempt, deliveryInput);
  const { statement: _, ...reference } = deliveryInput;
  void _;
  await f.delivery.confirmFirstFiscalDocumentKept(
    f.ownerAttempt,
    { ...reference, kept: true },
    await f.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
  );
  const result = await f.delivery.read(f.context.binding);
  expect(result).toEqual({ trust: null, current: statement });
  const root = join(f.stateDir, "first-fiscal-documents");
  const files = await readdir(root);
  expect(files.filter((p) => /-\d+\.json$/.test(p)).length).toBeGreaterThan(1);
  for (const path of files)
    expect(Buffer.byteLength(await readFile(join(root, path), "utf8"))).toBeLessThanOrEqual(48000);
  await expect(readFile(join(f.stateDir, "module-operation-public.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("cannot register a successor before the durable consumption intent", async () => {
  const f = await fixture();
  const path = join(f.stateDir, "first-setup.json"),
    saved = JSON.parse(await readFile(path, "utf8"));
  saved.history = saved.history.filter(
    (event: { kind: string }) => event.kind !== "consumption-intent" && event.kind !== "import",
  );
  saved.revision = saved.history.length;
  saved.status = "claimed";
  saved.consumptionIntent = false;
  saved.inputs = {};
  await writeFile(path, JSON.stringify(saved));
  await expect(
    f.delivery.registerFirstFiscalDelivery(
      { ...f.ownerAttempt, revision: saved.revision },
      f.input,
    ),
  ).rejects.toMatchObject(missing);
});
it.each(["secret", "privateKey", "nodeKeys"])(
  "refuses a secret-bearing original's %s before storing public chunks",
  async (field) => {
    const f = await fixture();
    const { createHash } = await import("node:crypto");
    const bytes = Buffer.from(
      JSON.stringify({
        payload: { [field]: f.staged.key.secret },
        keyId: "a".repeat(64),
        signature: "A".repeat(86),
      }),
    );
    const history = {
        ...f.statement.history,
        originals: [
          {
            kind: "cloud-receipt" as const,
            bytesBase64url: bytes.toString("base64url"),
            digest: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      },
      historyDigest = publicDigest(history);
    const input = {
      ...f.statement.input,
      allocation: {
        ...f.statement.input.allocation,
        reservationEvidence: {
          ...(f.statement.input.allocation.reservationEvidence as object),
          historyDigest,
        },
      },
    };
    const path = join(f.stateDir, "first-setup.json"),
      saved = JSON.parse(await readFile(path, "utf8"));
    saved.inputs[f.module] = input;
    await writeFile(path, JSON.stringify(saved));
    const statement = {
      ...f.statement,
      input,
      history,
      delivery: { ...f.statement.delivery, historyDigest },
    };
    await expect(
      f.delivery.registerFirstFiscalDelivery(f.ownerAttempt, {
        ...f.input,
        inputDigest: publicDigest(input),
        historyDigest,
        statement,
      }),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    await expect(readdir(join(f.stateDir, "first-fiscal-documents"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
