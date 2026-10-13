import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { locationId, nodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A, TENANT_B } from "../test/fixtures.js";
import * as fiscal from "./index.js";
import { registerSif } from "./registro-sif.js";
import { registroSif } from "./schema/sif.js";
import { fiscalReservations } from "./schema/reservations.js";
import { fiscalAllocations } from "./schema/allocations.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperReservationForBlock,
} from "./paper-evidence.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const standby = { nodeId: TENANT_A.nodeId2, locationId: primary.locationId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian(
  "standby-custodian",
  publicKey,
  paperCustodianFingerprint(publicKey),
)!;
const allocation = {
  version: 1 as const,
  allocationId: "spare-allocation-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
  source: "paper" as const,
  issuedAt: "2026-10-13T10:00:00.000Z",
};
function request(action = "reserve", target = standby) {
  const binding = {
    module: "fiscal-verifactu",
    action,
    eventId: "join-spare-42",
    sourceId: primary.nodeId,
    targetNodeId: target.nodeId,
  };
  const operatorId = "administrator";
  const incidentEvidence = "current-master/join-spare-42";
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "standby-custodian",
      generationId: "generation-1",
      blockId: "spare-block",
      packVersion: 1,
      recipientVenueId: "spare-venue",
      allocations: [allocation],
    },
    privateKey,
  );
  const evidence = {
    block,
    reservation: signPaperReservationForBlock(
      block,
      allocation.allocationId,
      {
        eventId: binding.eventId,
        operatorId,
        sourceId: binding.sourceId,
        targetNodeId: binding.targetNodeId,
        incidentEvidence,
        reservedAt: "2026-10-13T11:00:00.000Z",
      },
      privateKey,
    ),
  };
  const current = {
    trust,
    allocationId: allocation.allocationId,
    recipientVenueId: "spare-venue",
    generationId: "generation-1",
    blockId: "spare-block",
    incidentEvidence,
    currentRegisterConfirmed: true,
    reservationConfirmed: true,
    currentEntryState: "reserved" as const,
  };
  return { binding, operatorId, evidence, current };
}
type Request = ReturnType<typeof request>;
async function attempt<T>(
  action: string,
  run: (tx: Transaction, operation: ModuleOperationInput, held: Request) => Promise<T>,
  change: (held: Request) => void = () => {},
  target = standby,
) {
  const held = request(action, target);
  change(held);
  const preparation = fiscal.createStandbyAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: held.current,
  }));
  return withOperationAuthority(held.binding, held.operatorId, (authority) =>
    preparation.prepare({ binding: held.binding, authority, input: held.evidence }, (operation) =>
      withTransaction(suite.db, (tx) => run(tx, operation, held)),
    ),
  );
}
const lifecycle = () => fiscal.ALLOCATED_FISCAL_STANDBY;
async function rows() {
  return {
    sif: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    chains: (await suite.db.execute(sql`select * from cadenas`)).rows,
    counters: (await suite.db.execute(sql`select * from contadores_instalacion`)).rows,
    allocations: await suite.db.select().from(fiscalAllocations),
    reservations: await suite.db.select().from(fiscalReservations),
  };
}
function refusal(reason: string) {
  return { code: "sif.allocation_invalid", params: { reason } };
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: primary.nodeId,
      nif: allocation.taxpayerNif,
      idSistemaInformatico: allocation.softwareId,
    }),
  );
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: primary.nodeId })));
});

it("reserves a supplied signed identity for a not-yet-present spare without opening any fiscal rows", async () => {
  const future = { ...standby, nodeId: nodeId("a0000000-0000-4000-8000-000000000010") };
  const before = await rows();
  await attempt(
    "reserve",
    async (tx, operation, held) => {
      const reserved = await lifecycle().reserve(tx, primary, future, operation);
      expect(reserved).toEqual({ state: { version: 1, evidence: held.evidence } });
      expect(JSON.stringify(reserved)).not.toContain("publicKey");
      expect(JSON.stringify(reserved)).not.toContain("authority");
    },
    undefined,
    future,
  );
  expect(await rows()).toEqual(before);
});

it("establishes only the signed dormant reservation and retains all three purpose bases", async () => {
  const before = await rows();
  await attempt("establish", async (tx, operation, held) =>
    lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence }, operation),
  );
  const after = await rows();
  expect({ ...after, reservations: [] }).toEqual(before);
  expect(after.reservations).toHaveLength(1);
  expect(after.reservations[0]).toMatchObject({
    eventKey: "join-spare-42",
    allocationKey: "spare-allocation-42",
    sourceNodeId: primary.nodeId,
    nodeId: standby.nodeId,
    installationIdentity: "P000042",
    bases,
  });
  expect(
    await suite.db.select().from(registroSif).where(eq(registroSif.nodeId, standby.nodeId)),
  ).toEqual([]);
  expect(
    await suite.db
      .select()
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, standby.nodeId), isNull(invoiceSeries.retiredAt))),
  ).toEqual([]);
});

it("rechecks the independent current reservation on every idempotent establishment", async () => {
  await attempt("establish", (tx, operation, held) =>
    lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence }, operation),
  );
  const before = await rows();
  await attempt("establish", (tx, operation, held) =>
    lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence }, operation),
  );
  expect(await rows()).toEqual(before);
  await expect(
    attempt(
      "establish",
      (tx, operation, held) =>
        lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence }, operation),
      (held) => {
        held.current.reservationConfirmed = false;
      },
    ),
  ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  expect(await rows()).toEqual(before);
});

it.each(["reserve", "establish"])("refuses %s without a fresh scoped authority", async (action) => {
  const held = request(action);
  await expect(
    withTransaction(suite.db, async (tx) => {
      if (action === "reserve") await lifecycle().reserve(tx, primary, standby);
      else await lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence });
    }),
  ).rejects.toMatchObject(refusal("reauthentication_required"));
  expect((await rows()).reservations).toEqual([]);
});

it.each(["currentRegisterConfirmed", "reservationConfirmed"] as const)(
  "refuses reservation with %s missing from the independent source",
  async (field) => {
    const before = await rows();
    await expect(
      attempt(
        "reserve",
        (tx, operation) => lifecycle().reserve(tx, primary, standby, operation),
        (held) => {
          held.current[field] = false;
        },
      ),
    ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
    expect(await rows()).toEqual(before);
  },
);

it("refuses an establishment state different from the independently prepared signed proof", async () => {
  await expect(
    attempt("establish", async (tx, operation, held) => {
      const tampered = structuredClone(held.evidence);
      tampered.reservation = {
        ...tampered.reservation,
        payload: { ...tampered.reservation.payload, incidentEvidence: "a different join" },
      };
      await lifecycle().establish(tx, standby, { version: 1, evidence: tampered }, operation);
    }),
  ).rejects.toMatchObject(refusal("reservation_mismatch"));
  expect((await rows()).reservations).toEqual([]);
});

it("binds reserve to the primary actually read by the host", async () => {
  await expect(
    attempt("reserve", (tx, operation) =>
      lifecycle().reserve(
        tx,
        { ...primary, nodeId: TENANT_B.nodeId, locationId: locationId(TENANT_B.locationId) },
        standby,
        operation,
      ),
    ),
  ).rejects.toMatchObject(refusal("node_mismatch"));
});

it("refuses establishment in another location even with a valid signed proof", async () => {
  await suite.db
    .update(nodes)
    .set({ locationId: TENANT_B.locationId })
    .where(eq(nodes.id, standby.nodeId));
  await expect(
    attempt("establish", (tx, operation, held) =>
      lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence }, operation),
    ),
  ).rejects.toMatchObject(refusal("node_mismatch"));
});

it("rolls back dormant evidence when a later host write fails, retaining the outside mark", async () => {
  const before = await rows();
  const refusalError = new Error("host write refused");
  const current = request().current;
  await expect(
    attempt("establish", async (tx, operation, held) => {
      await lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence }, operation);
      throw refusalError;
    }),
  ).rejects.toBe(refusalError);
  expect(await rows()).toEqual(before);
  expect(current.currentEntryState).toBe("reserved");
});

it("expires prepared reservation input when collection's callback has finished", async () => {
  const held = request();
  const preparation = fiscal.createStandbyAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: held.current,
  }));
  await withOperationAuthority(held.binding, held.operatorId, async (authority) => {
    let captured: ModuleOperationInput;
    await preparation.prepare(
      { binding: held.binding, authority, input: held.evidence },
      async (operation) => {
        captured = operation;
      },
    );
    await expect(
      withTransaction(suite.db, (tx) => lifecycle().reserve(tx, primary, standby, captured)),
    ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  });
});

it.each(["consumed-for-event", "consumed-elsewhere", "retired", "abandoned"] as const)(
  "refuses an outside entry that is %s",
  async (state) => {
    const held = request();
    const preparation = fiscal.createStandbyAllocationPreparation(async (scope) => ({
      ...scope,
      evidence: { ...held.current, currentEntryState: state },
    }));
    await expect(
      withOperationAuthority(held.binding, held.operatorId, (authority) =>
        preparation.prepare(
          { binding: held.binding, authority, input: held.evidence },
          async () => {
            throw new Error("must not enter transaction");
          },
        ),
      ),
    ).rejects.toMatchObject(refusal("reservation_not_current"));
  },
);

it.each(["reserve", "establish"])("refuses %s after its scoped authority ends", async (action) => {
  let captured: ModuleOperationInput;
  await attempt(action, async (_tx, operation) => {
    captured = operation;
  });
  await expect(
    withTransaction(suite.db, async (tx) => {
      if (action === "reserve") await lifecycle().reserve(tx, primary, standby, captured);
      else
        await lifecycle().establish(
          tx,
          standby,
          { version: 1, evidence: request(action).evidence },
          captured,
        );
    }),
  ).rejects.toMatchObject(refusal("reauthentication_required"));
});

it.each(["module", "action", "eventId", "sourceId", "targetNodeId"] as const)(
  "refuses a prepared token rebound by %s",
  async (field) => {
    await expect(
      attempt("reserve", (tx, operation) =>
        lifecycle().reserve(tx, primary, standby, {
          ...operation,
          binding: { ...operation.binding, [field]: "different" },
        }),
      ),
    ).rejects.toMatchObject(refusal("reauthentication_required"));
  },
);

it("refuses a cloned prepared token even while authentication remains live", async () => {
  await expect(
    attempt("reserve", (tx, operation) =>
      lifecycle().reserve(tx, primary, standby, {
        ...operation,
        input: structuredClone(operation.input),
      }),
    ),
  ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
});

it("rejects another action's prepared token", async () => {
  await expect(
    attempt("establish", (tx, operation) => lifecycle().reserve(tx, primary, standby, operation)),
  ).rejects.toMatchObject(refusal("event_mismatch"));
});

it("rejects a token for another supplied standby", async () => {
  await expect(
    attempt("reserve", (tx, operation) =>
      lifecycle().reserve(tx, primary, { ...standby, nodeId: TENANT_B.nodeId }, operation),
    ),
  ).rejects.toMatchObject(refusal("node_mismatch"));
});

it("rejects reservation without a named target node", async () => {
  await expect(
    attempt("reserve", (tx, operation) => lifecycle().reserve(tx, primary, undefined, operation)),
  ).rejects.toMatchObject(refusal("node_mismatch"));
});

it("refuses supplied extra proof fields before cloning drops them", async () => {
  const held = request();
  Object.defineProperty(held.evidence, "hidden", { value: "extra" });
  const preparation = fiscal.createStandbyAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: held.current,
  }));
  await expect(
    withOperationAuthority(held.binding, held.operatorId, (authority) =>
      preparation.prepare(
        { binding: held.binding, authority, input: held.evidence },
        async () => {},
      ),
    ),
  ).rejects.toMatchObject(refusal("malformed"));
});

it("refuses an uncloneable proof before entering the transaction", async () => {
  const held = request();
  const preparation = fiscal.createStandbyAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: held.current,
  }));
  await expect(
    withOperationAuthority(held.binding, held.operatorId, (authority) =>
      preparation.prepare(
        {
          binding: held.binding,
          authority,
          input: { block: () => {}, reservation: held.evidence.reservation },
        },
        async () => {},
      ),
    ),
  ).rejects.toMatchObject(refusal("malformed"));
});

it("refuses absent outside source even for a correctly signed join", async () => {
  const held = request();
  await expect(
    withOperationAuthority(held.binding, held.operatorId, (authority) =>
      fiscal
        .createStandbyAllocationPreparation(undefined)
        .prepare({ binding: held.binding, authority, input: held.evidence }, async () => {}),
    ),
  ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
});

it.each(["null", "extra field", "another event", "another operator"])(
  "refuses source receipt with %s",
  async (kind) => {
    const held = request();
    const preparation = fiscal.createStandbyAllocationPreparation(async (scope) =>
      kind === "null"
        ? null
        : {
            ...scope,
            ...(kind === "another event"
              ? { binding: { ...scope.binding, eventId: "another" } }
              : {}),
            ...(kind === "another operator" ? { operatorId: "another" } : {}),
            evidence: { ...held.current, ...(kind === "extra field" ? { extra: true } : {}) },
          },
    );
    await expect(
      withOperationAuthority(held.binding, held.operatorId, (authority) =>
        preparation.prepare(
          { binding: held.binding, authority, input: held.evidence },
          async () => {},
        ),
      ),
    ).rejects.toMatchObject(
      refusal(
        kind === "another event" || kind === "another operator"
          ? "event_mismatch"
          : "outside_confirmation_missing",
      ),
    );
  },
);

it("retains detached request and source evidence when caller changes its originals", async () => {
  const held = request();
  const preparation = fiscal.createStandbyAllocationPreparation(async (scope) => {
    held.evidence.reservation = {
      ...held.evidence.reservation,
      signature: "changed-after-collection",
    };
    return { ...scope, evidence: held.current };
  });
  await withOperationAuthority(held.binding, held.operatorId, (authority) =>
    preparation.prepare(
      { binding: held.binding, authority, input: held.evidence },
      async (operation) => {
        held.current.allocationId = "another";
        held.current.reservationConfirmed = false;
        await expect(
          withTransaction(suite.db, (tx) => lifecycle().reserve(tx, primary, standby, operation)),
        ).resolves.toEqual({ state: { version: 1, evidence: request().evidence } });
      },
    ),
  );
});

it("refuses the spare when it already has an active fiscal identity", async () => {
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: standby.nodeId,
      nif: allocation.taxpayerNif,
      idSistemaInformatico: allocation.softwareId,
    }),
  );
  const before = await rows();
  await expect(
    attempt("establish", (tx, operation, held) =>
      lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence }, operation),
    ),
  ).rejects.toMatchObject(refusal("standby_already_active"));
  expect(await rows()).toEqual(before);
});

it.each([
  null,
  { version: 2, evidence: request("establish").evidence },
  { version: 1 },
  { version: 1, evidence: request("establish").evidence, trust },
])("refuses a malformed dormant carrier state %j", async (state) => {
  await expect(
    attempt("establish", (tx, operation) => lifecycle().establish(tx, standby, state, operation)),
  ).rejects.toMatchObject(refusal("reservation_mismatch"));
  expect((await rows()).reservations).toEqual([]);
});

it.each(["reserve", "establish"])(
  "uses the configured paper preparation for %s with separate trust and current statement files",
  async (action) => {
    const held = request(action);
    const folder = await mkdtemp(join(tmpdir(), "standby-configured-lifecycle-"));
    try {
      const configuration = {
        custodianPath: join(folder, "public.json"),
        confirmationPath: join(folder, "current.json"),
        confirmedFingerprint: trust.fingerprint,
      };
      await writeFile(configuration.custodianPath, JSON.stringify(trust));
      const current = Object.fromEntries(
        Object.entries(held.current).filter(([field]) => field !== "trust"),
      );
      await writeFile(
        configuration.confirmationPath,
        JSON.stringify({
          version: 1,
          ...current,
          binding: held.binding,
          operatorId: held.operatorId,
        }),
      );
      const preparation = fiscal.createPaperAllocationPreparation(configuration);
      await withOperationAuthority(held.binding, held.operatorId, (authority) =>
        preparation.prepare(
          { binding: held.binding, authority, input: held.evidence },
          (operation) =>
            withTransaction(suite.db, async (tx) => {
              if (action === "reserve")
                expect(await lifecycle().reserve(tx, primary, standby, operation)).toEqual({
                  state: { version: 1, evidence: held.evidence },
                });
              else
                await lifecycle().establish(
                  tx,
                  standby,
                  { version: 1, evidence: held.evidence },
                  operation,
                );
            }),
        ),
      );
      expect((await rows()).reservations).toHaveLength(action === "reserve" ? 0 : 1);
      expect((await rows()).allocations).toEqual([]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it("refuses to reserve for a spare that already has an active SIF", async () => {
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: standby.nodeId,
      nif: allocation.taxpayerNif,
      idSistemaInformatico: allocation.softwareId,
    }),
  );
  const before = await rows();
  await expect(
    attempt("reserve", (tx, operation) => lifecycle().reserve(tx, primary, standby, operation)),
  ).rejects.toMatchObject(refusal("standby_already_active"));
  expect(await rows()).toEqual(before);
});

it("refuses to reserve for a stored spare in another location", async () => {
  await suite.db
    .update(nodes)
    .set({ locationId: TENANT_B.locationId })
    .where(eq(nodes.id, standby.nodeId));
  await expect(
    attempt("reserve", (tx, operation) => lifecycle().reserve(tx, primary, standby, operation)),
  ).rejects.toMatchObject(refusal("node_mismatch"));
});

it("refuses to reserve for a spare that already has an open series", async () => {
  await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: standby.nodeId, code: "spare-open", purpose: "standard" });
  const before = await rows();
  await expect(
    attempt("reserve", (tx, operation) => lifecycle().reserve(tx, primary, standby, operation)),
  ).rejects.toMatchObject(refusal("standby_already_active"));
  expect(await rows()).toEqual(before);
});
