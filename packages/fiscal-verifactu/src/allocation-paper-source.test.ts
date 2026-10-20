import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { withCollectedModuleAllocation } from "./allocation-operation.js";
import * as sources from "./allocation-paper-source.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { runPaperCustodian } from "./paper-custodian.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "source-recovery",
  sourceId: "selected-backup",
  targetNodeId: node.nodeId,
};
const operatorId = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const candidate = {
  version: 1 as const,
  allocationId: "paper-source-42",
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
const block = signPaperBlock(
  {
    version: 1,
    custodianId: "external-custodian",
    generationId: "current-generation",
    blockId: "current-block",
    packVersion: 1,
    recipientVenueId: "source-venue",
    allocations: [candidate],
  },
  privateKey,
);
const approval = {
  version: 1 as const,
  eventId: binding.eventId,
  operatorId,
  sourceId: binding.sourceId,
  targetNodeId: binding.targetNodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-13T11:00:00.000Z",
  incidentEvidence: "outside/source-42",
};
const consumption = signPaperConsumptionForBlock(
  block,
  candidate.allocationId,
  {
    eventId: binding.eventId,
    operatorId,
    sourceId: binding.sourceId,
    targetNodeId: binding.targetNodeId,
    incidentEvidence: approval.incidentEvidence,
    consumedAt: approval.confirmedAt,
  },
  privateKey,
);
const input = {
  allocation: { ...candidate, reservationEvidence: { block, consumption } },
  approval,
};
const confirmation = {
  version: 1,
  allocationId: "paper-source-42",
  binding,
  operatorId,
  priorActivation: "none",
  incidentEvidence: approval.incidentEvidence,
  requiredBases: bases,
  recipientVenueId: "source-venue",
  generationId: "current-generation",
  blockId: "current-block",
  currentRegisterConfirmed: true,
  consumptionConfirmed: true,
  currentEntryState: "consumed-for-event",
};
const custodian = { custodianId: "external-custodian", publicKey, fingerprint };

async function withFiles(
  run: (paths: { custodianPath: string; confirmationPath: string }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "allocation-paper-source-"));
  try {
    const paths = {
      custodianPath: join(dir, "public.json"),
      confirmationPath: join(dir, "current.json"),
    };
    await writeFile(paths.custodianPath, JSON.stringify(custodian));
    await writeFile(paths.confirmationPath, JSON.stringify(confirmation));
    await run(paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function attempt(
  paths: { custodianPath: string; confirmationPath: string },
  expected = fingerprint,
) {
  const source = sources.createPaperAllocationSource({ ...paths, confirmedFingerprint: expected });
  return withOperationAuthority(binding, operatorId, (authority) =>
    withCollectedModuleAllocation({ binding, authority, input }, source, (activate) =>
      withTransaction(suite.db, (tx) => activate(tx, node)),
    ),
  );
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
});

it("activates only the complete signed allocation confirmed by the separate files", async () => {
  await withFiles(async (paths) => {
    const result = await attempt(paths);
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "R-P000042", purpose: "rectificative" },
    ]);
    expect(
      await suite.db.select({ identity: registroSif.numeroInstalacion }).from(registroSif),
    ).toEqual([{ identity: "P000042" }]);
    expect(
      await suite.db.select({ approval: fiscalAllocations.approval }).from(fiscalAllocations),
    ).toEqual([{ approval }]);
    expect(await suite.db.select().from(invoiceSeries)).toHaveLength(6);
  });
});

it("does not enrol a key using the fingerprint in its own file", async () => {
  await withFiles(async (paths) => {
    await expect(attempt(paths, "other-outside-fingerprint")).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
    expect(await suite.db.select().from(registroSif)).toEqual([]);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
});

it("refuses a private signing key in the public-key file even when its fingerprint matches", async () => {
  await withFiles(async (paths) => {
    await writeFile(paths.custodianPath, JSON.stringify({ ...custodian, publicKey: privateKey }));
    await expect(attempt(paths)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
});

it("rereads current confirmation on a retry rather than trusting a prior file snapshot", async () => {
  await withFiles(async (paths) => {
    const source = sources.createPaperAllocationSource({
      ...paths,
      confirmedFingerprint: fingerprint,
    });
    const request = { binding, operatorId };
    expect((await source(request))?.evidence.authority).toMatchObject({
      currentEntryState: "consumed-for-event",
    });
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, currentEntryState: "retired" }),
    );
    expect((await source(request))?.evidence.authority).toMatchObject({
      currentEntryState: "retired",
    });
    await expect(attempt(paths)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "allocation_retired" },
    });
  });
});

it.each([
  ["currentRegisterConfirmed", "yes"],
  ["consumptionConfirmed", 1],
  ["version", 2],
  ["priorActivation", "unknown"],
  ["currentEntryState", "unknown"],
  ["requiredBases", null],
  ["requiredBases", [{ code: "A", purpose: 1 }]],
  ["requiredBases", [{ code: "A", purpose: "standard", extra: true }]],
  ["requiredBases", []],
  ["incidentEvidence", ""],
  ["blockId", ""],
  ["generationId", ""],
  ["recipientVenueId", ""],
  ["trust", custodian],
  ["allocationId", ""],
])("refuses malformed current confirmation %s=%j before activation", async (field, value) => {
  await withFiles(async (paths) => {
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, [field as string]: value }),
    );
    const source = sources.createPaperAllocationSource({
      ...paths,
      confirmedFingerprint: fingerprint,
    });
    await expect(source({ binding, operatorId })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    await expect(attempt(paths)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await suite.db.select().from(registroSif)).toEqual([]);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(
      await suite.db
        .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
        .from(invoiceSeries),
    ).toEqual(bases);
  });
});

it("reads the actual custodian command's public output with an outside fingerprint", async () => {
  await withFiles(async (paths) => {
    const keyPath = paths.custodianPath + ".private";
    await writeFile(keyPath, privateKey, { mode: 0o600 });
    let output = "";
    const errors: string[] = [];
    expect(
      await runPaperCustodian(["public", "--custodian", "external-custodian", "--key", keyPath], {
        stdout: (line) => {
          output = line;
        },
        stderr: (line) => errors.push(line),
      }),
    ).toBe(0);
    expect(errors).toEqual([]);
    await writeFile(paths.custodianPath, output);
    expect((await attempt(paths)).activationEventId).toBe(binding.eventId);
  });
});

it.each([
  ["reserved", "reservation_not_consumed"],
  ["consumed-elsewhere", "allocation_consumed"],
  ["abandoned", "reservation_abandoned"],
])(
  "refuses the current outside state %s despite a valid consumption signature",
  async (state, reason) => {
    await withFiles(async (paths) => {
      await writeFile(
        paths.confirmationPath,
        JSON.stringify({ ...confirmation, currentEntryState: state }),
      );
      await expect(attempt(paths)).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason },
      });
      expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    });
  },
);

it.each(["currentRegisterConfirmed", "consumptionConfirmed"])(
  "requires fresh outside %s",
  async (field) => {
    await withFiles(async (paths) => {
      await writeFile(paths.confirmationPath, JSON.stringify({ ...confirmation, [field]: false }));
      await expect(attempt(paths)).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "outside_confirmation_missing" },
      });
      expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    });
  },
);

it("replays the committed event without recreating series or resetting its counter", async () => {
  await withFiles(async (paths) => {
    const first = await attempt(paths);
    await suite.db
      .update(invoiceSeries)
      .set({ nextNumber: 14 })
      .where(eq(invoiceSeries.id, first.series[0]!.id));
    const series = await suite.db.select().from(invoiceSeries);
    const sifs = await suite.db.select().from(registroSif);
    const activations = await suite.db.select().from(fiscalAllocations);
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, priorActivation: "committed" }),
    );
    expect(await attempt(paths)).toEqual(first);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(series);
    expect(await suite.db.select().from(registroSif)).toEqual(sifs);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual(activations);
  });
});

it("cannot free the outside consumed entry when the local caller rolls back", async () => {
  await withFiles(async (paths) => {
    const source = sources.createPaperAllocationSource({
      ...paths,
      confirmedFingerprint: fingerprint,
    });
    const external = await readFile(paths.confirmationPath, "utf8");
    const series = await suite.db.select().from(invoiceSeries);
    await expect(
      withOperationAuthority(binding, operatorId, (authority) =>
        withCollectedModuleAllocation({ binding, authority, input }, source, (activate) =>
          withTransaction(suite.db, async (tx) => {
            await activate(tx, node);
            throw new Error("caller-rollback");
          }),
        ),
      ),
    ).rejects.toThrow("caller-rollback");
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await suite.db.select().from(registroSif)).toEqual([]);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(series);
    expect(await readFile(paths.confirmationPath, "utf8")).toBe(external);
  });
});

it("refuses an uncertain previous activation", async () => {
  await withFiles(async (paths) => {
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, priorActivation: "uncertain" }),
    );
    await expect(attempt(paths)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "uncertain_prior_activation" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
});

it("holds configuration selected by the host despite caller mutation", async () => {
  await withFiles(async (paths) => {
    const configuration = { ...paths, confirmedFingerprint: fingerprint };
    const source = sources.createPaperAllocationSource(configuration);
    configuration.custodianPath = "";
    configuration.confirmationPath = "";
    configuration.confirmedFingerprint = "self-enrolled";
    expect(await source({ binding, operatorId })).toMatchObject({
      binding,
      operatorId,
      evidence: { allocationId: "paper-source-42", authority: { trust: custodian } },
    });
  });
});

it.each(["custodianPath", "confirmationPath"] as const)(
  "accepts %s at the 64 KiB boundary",
  async (field) => {
    await withFiles(async (paths) => {
      const json = JSON.stringify(field === "custodianPath" ? custodian : confirmation);
      await writeFile(paths[field], json + " ".repeat(65536 - Buffer.byteLength(json)));
      expect((await attempt(paths)).activationEventId).toBe(binding.eventId);
    });
  },
);

it("refuses current confirmation for another allocation in the same block", async () => {
  await withFiles(async (paths) => {
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, allocationId: "other-entry" }),
    );
    await expect(attempt(paths)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await suite.db.select().from(registroSif)).toEqual([]);
  });
});

it.each([{ allocation: null }, { allocation: 42 }, { allocation: {} }, { allocation: [] }])(
  "refuses an allocation without a matching ID: $allocation",
  async ({ allocation }) => {
    await withFiles(async (paths) => {
      const source = sources.createPaperAllocationSource({
        ...paths,
        confirmedFingerprint: fingerprint,
      });
      await expect(
        withOperationAuthority(binding, operatorId, (authority) =>
          withCollectedModuleAllocation(
            { binding, authority, input: { ...input, allocation } },
            source,
            (activate) => withTransaction(suite.db, (tx) => activate(tx, node)),
          ),
        ),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "reservation_mismatch" },
      });
      expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    });
  },
);

it.each(["custodianPath", "confirmationPath"] as const)(
  "refuses missing, invalid or oversized %s without disclosing content",
  async (field) => {
    await withFiles(async (paths) => {
      const reason =
        field === "custodianPath" ? "reservation_untrusted" : "outside_confirmation_missing";
      for (const content of [
        "{secret:unprintable",
        "null",
        "[]",
        JSON.stringify(field === "custodianPath" ? custodian : confirmation) + " ".repeat(65536),
        " ".repeat(65536) + JSON.stringify(field === "custodianPath" ? custodian : confirmation),
      ]) {
        await writeFile(paths[field], content);
        await expect(attempt(paths)).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason },
        });
      }
      await rm(paths[field]);
      await expect(attempt(paths)).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason },
      });
      await expect(attempt({ ...paths, [field]: "" })).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason },
      });
      expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    });
  },
);

it.each(["binding", "operatorId"] as const)(
  "refuses a current receipt for another %s",
  async (field) => {
    await withFiles(async (paths) => {
      const value =
        field === "binding" ? { ...binding, sourceId: "another-backup" } : "another-person";
      await writeFile(paths.confirmationPath, JSON.stringify({ ...confirmation, [field]: value }));
      await expect(attempt(paths)).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "event_mismatch" },
      });
      expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    });
  },
);

it("detaches the authenticated request before reading files", async () => {
  await withFiles(async (paths) => {
    const source = sources.createPaperAllocationSource({
      ...paths,
      confirmedFingerprint: fingerprint,
    });
    const request = structuredClone({ binding, operatorId });
    const collected = source(request);
    request.binding.sourceId = "caller-changed";
    request.operatorId.eventId = "caller-changed";
    expect(await collected).toMatchObject({ binding, operatorId });
  });
});

it("rereads custodian keys and refuses a replaced key until independently enrolled", async () => {
  await withFiles(async (paths) => {
    const source = sources.createPaperAllocationSource({
      ...paths,
      confirmedFingerprint: fingerprint,
    });
    expect((await source({ binding, operatorId }))?.evidence.authority).toMatchObject({
      trust: custodian,
    });
    const replacement = generateKeyPairSync("ed25519");
    const key = replacement.publicKey.export({ type: "spki", format: "pem" }).toString();
    await writeFile(
      paths.custodianPath,
      JSON.stringify({ ...custodian, publicKey: key, fingerprint: paperCustodianFingerprint(key) }),
    );
    await expect(source({ binding, operatorId })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
});

it.each([
  ["custodianId", ""],
  ["publicKey", "invalid-key"],
  ["fingerprint", "different"],
  ["extra", true],
])("refuses malformed custodian %s", async (field, value) => {
  await withFiles(async (paths) => {
    await writeFile(
      paths.custodianPath,
      JSON.stringify({ ...custodian, [field as string]: value }),
    );
    await expect(attempt(paths)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
  });
});

it("adapts separately bound public trust/current without reading environment files", async () => {
  const source = sources.createBoundPaperAllocationSource({
    environment: {},
    readPublicEvidence: async () => ({ trust: custodian, current: confirmation }),
  });
  await expect(source({ binding, operatorId })).resolves.toMatchObject({
    binding,
    operatorId,
    evidence: {
      allocationId: "paper-source-42",
      priorActivation: "none",
      incidentEvidence: "outside/source-42",
      requiredBases: bases,
      authority: { kind: "paper", trust: custodian, currentEntryState: "consumed-for-event" },
    },
  });
});
it.each(["missing", "untrusted", "extra-current", "wrong-event"])(
  "refuses %s bound evidence",
  async (why) => {
    const source = sources.createBoundPaperAllocationSource({
      environment: {},
      readPublicEvidence: async () =>
        why === "missing"
          ? undefined
          : {
              trust:
                why === "untrusted" ? { ...custodian, fingerprint: "0".repeat(64) } : custodian,
              current:
                why === "extra-current"
                  ? { ...confirmation, secret: "refused" }
                  : why === "wrong-event"
                    ? { ...confirmation, binding: { ...binding, eventId: "other" } }
                    : confirmation,
            },
    });
    await expect(source({ binding, operatorId })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
    });
  },
);
