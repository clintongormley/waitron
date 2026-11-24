import { beforeEach, expect, it, vi } from "vitest";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
  type OperationOperator,
} from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "../test/fixtures.js";
import { activateAuthenticatedAllocation } from "./allocation.js";
import { withHourAdmission, type AllocationContext } from "./allocation-envelope.js";
import { withCollectedModuleAllocation } from "./allocation-operation.js";
import {
  isIdentityChangeAuthority,
  withIdentityChangeAuthority,
} from "./identity-change-authority.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TAXPAYER_A.nodeId };
const RELEASE = "1.4.0";
const IDENTITY_OPERATOR = `identity-change:${RELEASE}`;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "corrective" },
];
const refused = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });

function fixture(action: string, identity: string, eventId: string, operatorId: OperationOperator) {
  const binding: OperationBinding = {
    module: "fiscal-verifactu",
    action,
    eventId,
    sourceId: "owned-attempt",
    targetNodeId: node.nodeId,
  };
  const relinquished = action !== "setup";
  const input = {
    allocation: {
      version: 1,
      allocationId: `hour/${eventId}`,
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "preproduction",
      installationIdentity: identity,
      series: bases.map((base) => ({ ...base, code: `${base.code}-${identity}` })),
      source: "hour",
      reservationEvidence: null,
      issuedAt: relinquished ? "2026-10-16T12:00:00.000Z" : "2026-10-16T11:40:00.000Z",
    },
    approval: {
      version: relinquished ? 2 : 1,
      eventId,
      operatorId,
      sourceId: binding.sourceId,
      targetNodeId: node.nodeId,
      oldMachineOffline: false,
      oldMachineAbsent: !relinquished,
      noParallelRecovery: true,
      confirmedAt: "2026-10-16T11:40:00.000Z",
      incidentEvidence: `owned/${eventId}`,
      ...(relinquished ? { oldMachineRelinquished: true } : {}),
    },
  };
  return { binding, input, relinquished };
}

type Fixture = ReturnType<typeof fixture>;

function admitAndActivate(f: Fixture, authority: OperationAuthority) {
  const operation = { binding: f.binding, authority, input: f.input };
  return withHourAdmission(
    operation,
    {
      requiredBases: bases,
      priorActivation: "none",
      ...(f.relinquished ? { oldMachineRelinquished: true } : {}),
    },
    (evidence) =>
      withCollectedModuleAllocation(
        operation,
        async (request) => ({ ...request, evidence }),
        (write) => withTransaction(suite.db, (tx) => write(tx, node)),
      ),
  );
}

async function expectAdmissionRefused(f: Fixture, authority: OperationAuthority) {
  const body = vi.fn();
  await expect(
    withHourAdmission(
      { binding: f.binding, authority, input: f.input },
      { requiredBases: bases, priorActivation: "none", oldMachineRelinquished: f.relinquished },
      body,
    ),
  ).rejects.toMatchObject(refused("reauthentication_required"));
  expect(body).not.toHaveBeenCalled();
}

const identityChange = () =>
  fixture("identity-change", "0CNPG", "identity-hour", IDENTITY_OPERATOR);

function recoveryContext(
  binding: OperationBinding,
  operatorId: OperationOperator,
): AllocationContext {
  return {
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction",
    mode: "recovery",
    oldMachineRelinquished: true,
    eventId: binding.eventId,
    sourceId: binding.sourceId,
    targetNodeId: binding.targetNodeId,
    operatorId,
    incidentEvidence: `owned/${binding.eventId}`,
    requiredBases: bases,
    reauthentication: null,
    priorActivation: "none",
    authority: { kind: "hour", token: {} },
  };
}

beforeEach(async () => {
  await seedTaxpayers(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  const setup = fixture("setup", "0CNNW", "first-hour", "administrator");
  await withOperationAuthority(setup.binding, "administrator", (authority) =>
    admitAndActivate(setup, authority),
  );
});

it("opens a new installation through all three action checks under the private authority", async () => {
  const f = identityChange();
  const result = await withIdentityChangeAuthority(f.binding, RELEASE, (authority) => {
    expect(isIdentityChangeAuthority(authority)).toBe(true);
    return admitAndActivate(f, authority);
  });
  expect(result.activationEventId).toBe("identity-hour");
  const live = (await suite.db.select().from(verifactuIdentities)).filter(
    (row) => row.revocadoEn === null,
  );
  expect(live.map((row) => row.numeroInstalacion)).toEqual(["0CNPG"]);
});

it("refuses the identity-change action under an ordinary operation authority", async () => {
  const f = identityChange();
  await withOperationAuthority(f.binding, IDENTITY_OPERATOR, async (authority) => {
    expect(isIdentityChangeAuthority(authority)).toBe(false);
    await expectAdmissionRefused(f, authority);
    const source = vi.fn();
    await expect(
      withCollectedModuleAllocation(
        { binding: f.binding, authority, input: f.input },
        source,
        async () => undefined,
      ),
    ).rejects.toMatchObject(refused("reauthentication_required"));
    expect(source).not.toHaveBeenCalled();
    await expect(
      withTransaction(suite.db, (tx) =>
        activateAuthenticatedAllocation(
          tx,
          node,
          f.input.allocation,
          f.input.approval,
          recoveryContext(f.binding, IDENTITY_OPERATOR),
          authority,
          "identity-change",
        ),
      ),
    ).rejects.toMatchObject(refused("reauthentication_required"));
  });
});

it.each(["setup", "restore", "promote", "conflict-switch"])(
  "refuses the private authority bound to the %s action",
  async (action) => {
    const f = fixture(action, "0CNPG", "identity-hour", IDENTITY_OPERATOR);
    await withIdentityChangeAuthority(f.binding, RELEASE, async (authority) => {
      expect(isIdentityChangeAuthority(authority)).toBe(true);
      await expectAdmissionRefused(f, authority);
      const source = vi.fn();
      await expect(
        withCollectedModuleAllocation(
          { binding: f.binding, authority, input: f.input },
          source,
          async () => undefined,
        ),
      ).rejects.toMatchObject(refused("reauthentication_required"));
      expect(source).not.toHaveBeenCalled();
      await expect(
        withTransaction(suite.db, (tx) =>
          activateAuthenticatedAllocation(
            tx,
            node,
            f.input.allocation,
            f.input.approval,
            {
              ...recoveryContext(f.binding, IDENTITY_OPERATOR),
              mode: action === "setup" ? "initial-setup" : "recovery",
            },
            authority,
            action,
          ),
        ),
      ).rejects.toMatchObject(refused("reauthentication_required"));
    });
  },
);

it("refuses the private authority in initial-setup mode", async () => {
  const f = identityChange();
  await withIdentityChangeAuthority(f.binding, RELEASE, (authority) =>
    expect(
      withTransaction(suite.db, (tx) =>
        activateAuthenticatedAllocation(
          tx,
          node,
          f.input.allocation,
          f.input.approval,
          { ...recoveryContext(f.binding, IDENTITY_OPERATOR), mode: "initial-setup" },
          authority,
          "identity-change",
        ),
      ),
    ).rejects.toMatchObject(refused("reauthentication_required")),
  );
});

it("refuses the private authority once its run has settled", async () => {
  const f = identityChange();
  const kept = await withIdentityChangeAuthority(
    f.binding,
    RELEASE,
    async (authority) => authority,
  );
  expect(isIdentityChangeAuthority(kept)).toBe(false);
  await expect(admitAndActivate(f, kept)).rejects.toMatchObject(
    refused("reauthentication_required"),
  );
});

it("withdraws the private authority when its run throws", async () => {
  const f = identityChange();
  let kept: OperationAuthority | undefined;
  await expect(
    withIdentityChangeAuthority(f.binding, RELEASE, async (authority) => {
      kept = authority;
      throw new Error("stop");
    }),
  ).rejects.toThrow("stop");
  expect(isIdentityChangeAuthority(kept)).toBe(false);
});

it("names the release in the operator it issues", async () => {
  const f = identityChange();
  const wrong = fixture("identity-change", "0CNPG", "identity-hour", "identity-change:9.9.9");
  await withIdentityChangeAuthority(f.binding, RELEASE, async (authority) => {
    await expect(admitAndActivate(wrong, authority)).rejects.toMatchObject(
      refused("event_mismatch"),
    );
  });
});

it.each([null, undefined, {}, "authority"])(
  "does not take %s for the private authority",
  (value) => {
    expect(isIdentityChangeAuthority(value)).toBe(false);
  },
);
