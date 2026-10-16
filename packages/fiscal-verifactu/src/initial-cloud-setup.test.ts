import { validatePaperCandidates } from "./initial-paper-candidates.js";
import { declaredHistoryBytes, projectDeclaredHistory } from "./paper-register-history.js";
import type { DeclaredRegisterHistory, DeclaredReservation } from "./paper-register-protocol.js";
import type { DeclaredPaperConfirmation } from "./declared-paper-evidence.js";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { withOperationAuthority } from "@waitron/module";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { readCloudAllocationReport } from "./cloud-preparation.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InitialSetupContext } from "@waitron/module";
import { cloudReceiptFixture } from "../test/cloud-fixture.js";
import { createInitialCloudRequest, prepareInitialCloudSetup } from "./initial-cloud-setup.js";

const context: InitialSetupContext = {
  attemptId: "attempt-cloud",
  binding: {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "setup-event",
    sourceId: "first-setup:attempt-cloud",
    targetNodeId: "new-node",
  },
  administratorId: "planned-local-admin",
  country: "ES",
  taxId: "89890001K",
  environment: "production",
  recipientVenueId: "first-setup:attempt-cloud",
  bases: [
    { code: "A", purpose: "standard" },
    { code: "B", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
};
const venueId = "10000000-0000-4000-8000-000000000002";
const operationId = "10000000-0000-4000-8000-000000000001";
const incident = "first-setup/outside-consumption";

function fixture(change?: Parameters<typeof cloudReceiptFixture>[0], scope = context) {
  const context = scope;
  const request = createInitialCloudRequest(context, venueId, operationId, incident);
  const held = { ...context, request };
  const f = cloudReceiptFixture((p) => {
    Object.assign(p, { mode: "initial-setup", venueId });
    Object.assign(p.binding, {
      eventId: context.binding.eventId,
      sourceId: context.binding.sourceId,
      targetNodeId: context.binding.targetNodeId,
      operatorId: context.administratorId,
      incidentEvidence: incident,
    });
    Object.assign(p.approval!, p.binding, { oldMachineAbsent: true, oldMachineOffline: false });
    Object.assign(p.allocation, {
      softwareId: "W1",
      environment: "production",
      series: context.bases.map((b) => ({ code: `${b.code}-C000042`, purpose: b.purpose })),
    });
    Object.assign(p.continuity.scope, { softwareId: "W1", environment: "production" });
    change?.(p);
  });
  const input = {
    allocation: f.receipt.payload.allocation,
    approval: f.receipt.payload.approval,
    receipt: f.packet,
  };
  return { ...f, held, input };
}

describe("synthetic signed Cloud first-setup admission", () => {
  it("freezes the complete public reserve request without a paper register or Cloud actor", () => {
    const request = createInitialCloudRequest(context, venueId, operationId, incident);
    expect(request).toEqual({
      version: 1,
      operationId,
      venueId,
      scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "production" },
      bases: context.bases,
      binding: {
        eventId: "setup-event",
        sourceId: "first-setup:attempt-cloud",
        targetNodeId: "new-node",
        operatorId: "planned-local-admin",
        incidentEvidence: incident,
      },
      mode: "initial-setup",
    });
    expect(Object.isFrozen(request.bases)).toBe(true);
    expect(Object.isFrozen(request.binding)).toBe(true);
  });
  it("admits only the independently trusted consumed receipt and preserves its exact packet", () => {
    const f = fixture();
    const imported = prepareInitialCloudSetup(f.held, f.input, { trust: f.trust });
    expect(imported.input).toEqual(f.input);
    expect(imported.summary).toEqual({
      allocationId: "10000000-0000-4000-8000-000000000003",
      installationIdentity: "C000042",
      series: f.input.allocation.series,
      integrity: "signed-cloud",
      receiptId: "10000000-0000-4000-8000-000000000005",
    });
    expect(Object.isFrozen(imported.input)).toBe(true);
  });
  it.each(["reserved", "abandoned", "unknown"])("refuses an outside state of %s", (state) => {
    const f = fixture((p) => {
      Reflect.set(p, "state", state);
      if (state !== "consumed") Reflect.set(p, "approval", null);
    });
    expect(() => prepareInitialCloudSetup(f.held, f.input, { trust: f.trust })).toThrowError(
      expect.objectContaining({ code: "sif.allocation_invalid" }),
    );
  });
  it.each([
    "taxpayer",
    "software",
    "environment",
    "operator",
    "event",
    "source",
    "target",
    "bases",
    "venue",
    "mode",
    "operation",
  ])("refuses an authentically signed but changed %s", (field) => {
    const f = fixture((p) => {
      if (field === "taxpayer") {
        Reflect.set(p.allocation, "taxpayerNif", "50000000R");
        Reflect.set(p.continuity.scope, "taxpayerNif", "50000000R");
      }
      if (field === "software") {
        Reflect.set(p.allocation, "softwareId", "ZZ");
        Reflect.set(p.continuity.scope, "softwareId", "ZZ");
      }
      if (field === "environment") {
        Reflect.set(p.allocation, "environment", "preproduction");
        Reflect.set(p.continuity.scope, "environment", "preproduction");
      }
      const key = (
        {
          operator: "operatorId",
          event: "eventId",
          source: "sourceId",
          target: "targetNodeId",
        } as Record<string, string>
      )[field];
      if (key) {
        Reflect.set(p.binding, key, "different");
        Reflect.set(p.approval!, key, "different");
      }
      if (field === "bases")
        Reflect.set(
          p.allocation,
          "series",
          p.allocation.series.filter((b) => b.purpose !== "full"),
        );
      if (field === "venue") Reflect.set(p, "venueId", "10000000-0000-4000-8000-000000000099");
      if (field === "mode") {
        Reflect.set(p, "mode", "recovery");
        Object.assign(p.approval!, { oldMachineAbsent: false, oldMachineOffline: true });
      }
      if (field === "operation")
        Reflect.set(
          p.allocation.reservationEvidence as object,
          "reservationId",
          "10000000-0000-4000-8000-000000000099",
        );
    });
    expect(() => prepareInitialCloudSetup(f.held, f.input, { trust: f.trust })).toThrowError(
      expect.objectContaining({ code: "sif.allocation_invalid" }),
    );
  });
  it("refuses an initial receipt claiming an old machine was taken offline", () => {
    const f = fixture((p) => Reflect.set(p.approval!, "oldMachineOffline", true));
    expect(() => prepareInitialCloudSetup(f.held, f.input, { trust: f.trust })).toThrowError(
      expect.objectContaining({ code: "sif.allocation_invalid" }),
    );
  });
  it("refuses a Cloud account actor substituted for the planned local administrator", () => {
    const f = fixture((p) => {
      Reflect.set(p.binding, "operatorId", p.cloudAccountId);
      Reflect.set(p.approval!, "operatorId", p.cloudAccountId);
    });
    expect(() => prepareInitialCloudSetup(f.held, f.input, { trust: f.trust })).toThrowError(
      expect.objectContaining({ params: { reason: "event_mismatch" } }),
    );
  });
  it.each([null, { issuer: "uploaded-key", keys: new Map() }])(
    "refuses missing or independently different trust",
    (trust) => {
      const f = fixture();
      expect(() => prepareInitialCloudSetup(f.held, f.input, { trust })).toThrowError(
        expect.objectContaining({ params: { reason: "reservation_untrusted" } }),
      );
    },
  );
  it("refuses a well-formed forged signature under the independently trusted key", () => {
    const f = fixture();
    const forged = { ...f.input, receipt: { ...f.receipt, signature: "A".repeat(86) } };
    expect(() => prepareInitialCloudSetup(f.held, forged, { trust: f.trust })).toThrowError(
      expect.objectContaining({ params: { reason: "reservation_untrusted" } }),
    );
  });
  it("refuses a changed frozen bases list even when the signed receipt still matches the original complete context", () => {
    const f = fixture();
    const request = {
      ...f.held.request,
      bases: f.held.request.bases.filter((b) => b.purpose !== "full"),
    };
    expect(() =>
      prepareInitialCloudSetup({ ...f.held, request }, f.input, { trust: f.trust }),
    ).toThrowError(expect.objectContaining({ params: { reason: "event_mismatch" } }));
  });
  it("refuses edited bytes, allocation substitution, extra fields and a changed frozen request", () => {
    const f = fixture();
    for (const input of [
      { ...f.input, receipt: f.packet.slice(0, -2) + "AA" },
      { ...f.input, allocation: { ...f.input.allocation, installationIdentity: "C000043" } },
      { ...f.input, trust: f.trust },
    ]) {
      expect(() => prepareInitialCloudSetup(f.held, input, { trust: f.trust })).toThrowError(
        expect.objectContaining({ code: "sif.allocation_invalid" }),
      );
    }
    expect(() =>
      prepareInitialCloudSetup({ ...f.held, administratorId: "changed" }, f.input, {
        trust: f.trust,
      }),
    ).toThrowError(expect.objectContaining({ code: "sif.allocation_invalid" }));
  });
});

describe("synthetic Cloud receipt through initial setup and the actual activation", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
  const directories: string[] = [];
  const scope = { ...context, binding: { ...context.binding, targetNodeId: TENANT_A.nodeId } };
  beforeEach(async () => {
    await seedTenants(suite.db);
    await suite.db.insert(deployment).values({ id: 1, environment: "production" });
  });
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
  });
  async function setup(change?: Parameters<typeof cloudReceiptFixture>[0]) {
    const f = fixture(change, scope);
    const root = await mkdtemp(join(tmpdir(), "initial-cloud-"));
    directories.push(root);
    const trustPath = join(root, "issuer.json");
    await writeFile(
      trustPath,
      JSON.stringify({
        issuer: f.trust.issuer,
        fingerprint: f.receipt.keyId,
        publicKey: f.trust.keys.get(f.receipt.keyId),
      }),
    );
    const current = {
      version: 1,
      kind: "cloud-initial-confirmation",
      binding: scope.binding,
      operatorId: scope.administratorId,
      allocationId: f.input.allocation.allocationId,
      receiptId: f.receipt.payload.receiptId,
      priorActivation: "none",
      incidentEvidence: incident,
      requiredBases: scope.bases,
      delivery: {
        kept: true,
        documentDigest: "a".repeat(64),
        historyDigest: createHash("sha256").update(f.packet).digest("hex"),
      },
    };
    const host = {
      environment: {
        WAITRON_FISCAL_CLOUD_TRUST_FILE: trustPath,
        WAITRON_FISCAL_CLOUD_FINGERPRINT: f.receipt.keyId,
        WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY: root,
      },
      readPublicEvidence: async () => ({ trust: null, current }),
    };
    const seat = FISCAL_INITIAL_SETUP.configure!(host);
    return { ...f, root, host, current, seat };
  }
  it("exports a frozen Cloud request and prepares C setup before the paper source", async () => {
    const f = await setup();
    const candidates = f.seat.candidates(scope, {
      route: "cloud",
      venueId,
      operationId,
      incidentEvidence: incident,
    });
    expect(f.seat.request(scope, candidates)).toEqual(f.held.request);
    const imported = f.seat.inspect(f.held, f.input);
    expect(
      f.seat.documentConfirmation!(f.held, imported, {
        statement: f.current,
        historyDigest: f.current.delivery.historyDigest,
        documentDigest: "a".repeat(64),
        prior: null,
      }),
    ).toEqual(f.current);
    const paperScope = {
      taxpayerNif: scope.taxId,
      softwareId: "W1",
      environment: scope.environment,
    };
    const time = "2026-10-16T00:00:00.000Z";
    const priorPaper: DeclaredRegisterHistory = {
      format: "waitron-paper-register",
      version: 2,
      integrity: "owner-declared",
      scope: paperScope,
      registerId: "kept-before-cloud",
      mode: "checkpoint",
      originals: [],
      revisions: [],
      checkpoint: {
        version: 2,
        kind: "declared-burn-checkpoint",
        checkpointId: "typed-current-paper",
        scope: paperScope,
        sHighWater: 42,
        pHighWater: 7,
        current: {
          currentRegisterConfirmed: true,
          noParallelPaperAllocation: true,
          confirmedAt: time,
        },
        completeHistoryUnavailable: true,
        burnAllPrior: true,
        createdAt: time,
      },
    };
    const paperPath = join(f.root, "kept-paper-public.json");
    const priorBytes = declaredHistoryBytes(priorPaper);
    await writeFile(paperPath, priorBytes);
    const configured = FISCAL_OPERATIONS.configure!({
      ...f.host,
      environment: { ...f.host.environment, WAITRON_FISCAL_PAPER_HISTORY_FILE: paperPath },
    });
    const result = await withOperationAuthority(scope.binding, scope.administratorId, (authority) =>
      configured.prepare({ binding: scope.binding, authority, input: f.input }, (ready) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(
            tx,
            { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
            ready,
          ),
        ),
      ),
    );
    expect(result.series.map((b) => ({ code: b.code, purpose: b.purpose }))).toEqual([
      { code: "A-C000042", purpose: "standard" },
      { code: "B-C000042", purpose: "standard" },
      { code: "FF-C000042", purpose: "full" },
      { code: "R-C000042", purpose: "rectificative" },
    ]);
    f.current.priorActivation = "committed";
    const replay = await withOperationAuthority(scope.binding, scope.administratorId, (authority) =>
      configured.prepare({ binding: scope.binding, authority, input: f.input }, (ready) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(
            tx,
            { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
            ready,
          ),
        ),
      ),
    );
    expect(replay).toEqual(result);
    const rows = await suite.db.select().from(fiscalAllocations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.approval.operatorId).toBe("planned-local-admin");
    expect(await f.seat.committed(suite.db, f.held, f.input)).toEqual(result);
    const retained = JSON.parse(
      await readFile(
        join(
          f.root,
          createHash("sha256").update(f.input.allocation.allocationId).digest("hex") + ".json",
        ),
        "utf8",
      ),
    );
    expect(retained.receipt).toEqual(f.receipt);
    const report = await readCloudAllocationReport(
      suite.db,
      { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
      {
        receiptPath: join(
          f.root,
          createHash("sha256").update(f.input.allocation.allocationId).digest("hex") + ".json",
        ),
        trust: f.trust,
      },
    );
    expect(report.body.paperHistory).toBeNull();
    expect(report.body.activationEvidence.result).toEqual(result);
    expect(await readFile(paperPath)).toEqual(Buffer.from(priorBytes));
    const projection = projectDeclaredHistory(JSON.parse(await readFile(paperPath, "utf8")), {
      scope: paperScope,
      sHighWater: 0,
      pHighWater: 0,
      sBurnFloor: 0,
      pBurnFloor: 0,
      currentHead: null,
      retainedHeads: [],
      originals: [],
      retiredBindings: [],
    });
    expect({ s: projection.nextS, p: projection.nextP }).toEqual({ s: 43, p: 8 });
    const paperBinding = {
      ...scope.binding,
      action: "restore",
      eventId: "after-leaving-cloud",
      sourceId: "selected-backup",
    };
    const paperContext = {
      ...scope,
      binding: paperBinding,
      recipientVenueId: paperBinding.sourceId,
    };
    const candidate = validatePaperCandidates(paperContext, "P", [projection.nextP!])
      .candidates[0]!;
    const reservation: DeclaredReservation = {
      kind: "reserve",
      allocation: candidate,
      recipientVenueId: paperBinding.sourceId,
      binding: paperBinding,
      reservedAt: time,
    };
    const digest = (v: unknown) =>
      createHash("sha256").update(declaredHistoryBytes(v)).digest("hex");
    const operator = {
      kind: "recovery-key" as const,
      eventId: paperBinding.eventId,
      nodeId: paperBinding.targetNodeId,
    };
    const consumption = {
      kind: "consume" as const,
      allocationId: candidate.allocationId,
      reservationDigest: digest(reservation),
      eventId: paperBinding.eventId,
      operatorId: operator,
      sourceId: paperBinding.sourceId,
      targetNodeId: paperBinding.targetNodeId,
      incidentEvidence: "left-cloud/current-paper",
      consumedAt: time,
    };
    const history: DeclaredRegisterHistory = {
      ...priorPaper,
      revisions: [
        {
          version: 2,
          registerId: priorPaper.registerId,
          scope: paperScope,
          revision: "1",
          previousDigest: projection.head.digest,
          createdAt: time,
          sHighWater: 42,
          pHighWater: 8,
          events: [reservation, consumption],
        },
      ],
    };
    const paperInput = {
      allocation: {
        ...candidate,
        reservationEvidence: {
          kind: "paper-declared-evidence",
          version: 2,
          historyDigest: digest(history),
          reservation,
          consumption,
          reservationDigest: digest(reservation),
          consumptionDigest: digest(consumption),
        },
      },
      approval: {
        version: 1 as const,
        eventId: paperBinding.eventId,
        operatorId: operator,
        sourceId: paperBinding.sourceId,
        targetNodeId: paperBinding.targetNodeId,
        oldMachineAbsent: false,
        oldMachineOffline: true,
        noParallelRecovery: true,
        confirmedAt: time,
        incidentEvidence: consumption.incidentEvidence,
      },
    };
    const current: DeclaredPaperConfirmation = {
      version: 2,
      kind: "paper-declared-confirmation",
      binding: paperBinding,
      operatorId: operator,
      input: paperInput,
      history,
      known: {
        scope: paperScope,
        sHighWater: 42,
        pHighWater: 7,
        sBurnFloor: 42,
        pBurnFloor: 7,
        currentHead: projection.head,
        retainedHeads: projection.heads,
        originals: projection.originals,
        retiredBindings: projection.retiredBindings,
        history: priorPaper,
      },
      current: {
        currentRegisterConfirmed: true,
        noParallelPaperAllocation: true,
        confirmedAt: time,
      },
      recipientVenueId: paperBinding.sourceId,
      requiredBases: scope.bases,
      priorActivation: "none",
      phase: "activate",
      delivery: { kept: true, documentDigest: "d".repeat(64), historyDigest: digest(history) },
    };
    const offline = FISCAL_OPERATIONS.configure!({
      environment: {},
      readPublicEvidence: async () => ({ trust: null, current }),
    });
    const continued = await withOperationAuthority(paperBinding, operator, (authority) =>
      offline.prepare({ binding: paperBinding, authority, input: paperInput }, (ready) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(
            tx,
            { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
            ready,
          ),
        ),
      ),
    );
    expect(continued.series.map((b) => b.code)).toEqual([
      "A-P000008",
      "B-P000008",
      "FF-P000008",
      "R-P000008",
    ]);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
    expect(await readFile(paperPath)).toEqual(Buffer.from(priorBytes));
  });
  it("refuses a matching document declaration whose public-history digest is unrelated to the signed receipt", async () => {
    const f = await setup();
    f.current.delivery.historyDigest = "c".repeat(64);
    expect(() =>
      f.seat.documentConfirmation!(f.held, f.seat.inspect(f.held, f.input), {
        statement: f.current,
        historyDigest: "c".repeat(64),
        documentDigest: "a".repeat(64),
        prior: null,
      }),
    ).toThrowError(expect.objectContaining({ code: "sif.allocation_invalid" }));
  });
  it("binds object-receipt delivery to its canonical signed bytes", async () => {
    const f = await setup();
    const input = { ...f.input, receipt: f.receipt };
    const original = Buffer.from(
      f.packet.slice("WAITRON-FISCAL-ALLOCATION-1:".length),
      "base64url",
    );
    const historyDigest = createHash("sha256").update(original).digest("hex");
    const statement = { ...f.current, delivery: { ...f.current.delivery, historyDigest } };
    expect(
      f.seat.documentConfirmation!(f.held, f.seat.inspect(f.held, input), {
        statement,
        historyDigest,
        documentDigest: "a".repeat(64),
        prior: null,
      }),
    ).toEqual(statement);
  });
  it("refuses replacement of a previously retained receipt declaration by a different operator", async () => {
    const f = await setup();
    expect(() =>
      f.seat.documentConfirmation!(f.held, f.seat.inspect(f.held, f.input), {
        statement: f.current,
        historyDigest: f.current.delivery.historyDigest,
        documentDigest: "a".repeat(64),
        prior: { ...f.current, operatorId: "another-operator" },
      }),
    ).toThrowError(expect.objectContaining({ code: "sif.allocation_invalid" }));
  });
  it("admits a fresh committed-publication consultation for the same retained document and receipt", async () => {
    const f = await setup();
    const current = { ...f.current, priorActivation: "committed" };
    expect(
      f.seat.documentConfirmation!(f.held, f.seat.inspect(f.held, f.input), {
        statement: current,
        historyDigest: f.current.delivery.historyDigest,
        documentDigest: "a".repeat(64),
        prior: f.current,
      }),
    ).toEqual(current);
  });
  it.each([
    "missing-kept",
    "changed-document",
    "changed-history",
    "changed-current",
    "missing-trust",
  ])("refuses %s before recording a Cloud setup delivery", async (failure) => {
    const f = await setup();
    const imported = f.seat.inspect(f.held, f.input);
    if (failure === "missing-kept") Reflect.set(f.current.delivery, "kept", false);
    if (failure === "changed-document") f.current.delivery.documentDigest = "c".repeat(64);
    if (failure === "changed-history") f.current.delivery.historyDigest = "c".repeat(64);
    if (failure === "changed-current") f.current.operatorId = "Cloud-actor";
    if (failure === "missing-trust") await rm(f.host.environment.WAITRON_FISCAL_CLOUD_TRUST_FILE);
    expect(() =>
      f.seat.documentConfirmation!(f.held, imported, {
        statement: f.current,
        historyDigest: f.current.delivery.historyDigest,
        documentDigest: "a".repeat(64),
        prior: null,
      }),
    ).toThrowError(expect.objectContaining({ code: "sif.allocation_invalid" }));
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
  it("refuses recovery isolation flags at the actual first-setup preparation boundary", async () => {
    const f = await setup((p) => Reflect.set(p.approval!, "oldMachineOffline", true));
    await expect(
      withOperationAuthority(scope.binding, scope.administratorId, (authority) =>
        FISCAL_OPERATIONS.configure!(f.host).prepare(
          { binding: scope.binding, authority, input: f.input },
          (ready) =>
            withTransaction(suite.db, (tx) =>
              activatePreparedModuleAllocation(
                tx,
                { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
                ready,
              ),
            ),
        ),
      ),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
  it("does not accept live Cloud-account authority in place of the frozen local administrator", async () => {
    const f = await setup();
    await expect(
      withOperationAuthority(scope.binding, f.receipt.payload.cloudAccountId, (authority) =>
        FISCAL_OPERATIONS.configure!(f.host).prepare(
          { binding: scope.binding, authority, input: f.input },
          async () => "unexpected",
        ),
      ),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
});

it("retains independently configured public evidence roots for setup resolution", () => {
  const configured = FISCAL_INITIAL_SETUP.configure!({
    environment: {
      WAITRON_FISCAL_CLOUD_TRUST_FILE: "/outside/trust.json",
      WAITRON_FISCAL_CONFIRMATION_FILE: "/outside/current.json",
      WAITRON_FISCAL_PAPER_HISTORY_FILE: "/outside/history.json",
      WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY: "/outside/receipts",
    },
    readPublicEvidence: async () => undefined,
  });
  expect(configured.resolutionEvidence?.()).toEqual({
    files: ["/outside/trust.json", "/outside/current.json", "/outside/history.json"],
    directories: ["/outside/receipts"],
  });
});
