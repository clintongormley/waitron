import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withOperationAuthority } from "@waitron/module";
import { cloudReceiptFixture } from "../test/cloud-fixture.js";
import { FISCAL_INITIAL_SETUP, FISCAL_OPERATIONS } from "./index.js";
import { createCloudAllocationFilePreparation } from "./cloud-preparation.js";

afterEach(() => vi.unstubAllEnvs());

it.each(["symbol", "non-enumerable", "function"])(
  "refuses %s input before a missing host can mask it",
  async (kind) => {
    const input = {};
    if (kind === "symbol")
      Object.defineProperty(input, Symbol("hidden"), { value: true, enumerable: true });
    if (kind === "non-enumerable") Object.defineProperty(input, "hidden", { value: true });
    if (kind === "function") Object.assign(input, { callback: () => "unserialisable" });
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: "event",
      sourceId: "first-setup:attempt",
      targetNodeId: "node",
    };
    await withOperationAuthority(binding, "administrator", async (authority) => {
      await expect(
        FISCAL_OPERATIONS.prepare({ binding, authority, input }, async () => "admitted"),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "malformed_allocation" },
      });
    });
  },
);

it("a setup without a host cannot generate names from paper serials", () => {
  const context = {
    attemptId: "attempt",
    administratorId: "administrator",
    country: "ES",
    taxId: "89890001K",
    environment: "preproduction" as const,
    recipientVenueId: "first-setup:attempt",
    binding: {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: "event",
      sourceId: "first-setup:attempt",
      targetNodeId: "node",
    },
    bases: [
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ],
  };
  expect(() => FISCAL_INITIAL_SETUP.candidates(context, { serials: [1] })).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
});

it.each([
  ["ambient", "restore"],
  ["ambient", "re-register"],
  ["configured", "restore"],
  ["configured", "re-register"],
] as const)(
  "%s %s cannot use an old signed Cloud receipt as activation authority",
  async (mode, action) => {
    const root = await mkdtemp(join(tmpdir(), "retired-cloud-authority-"));
    try {
      const fixture = cloudReceiptFixture();
      const payload = fixture.receipt.payload;
      const binding = { module: "fiscal-verifactu", action, ...payload.binding };
      Reflect.deleteProperty(binding, "operatorId");
      Reflect.deleteProperty(binding, "incidentEvidence");
      const confirmation = {
        version: 1,
        binding,
        operatorId: payload.binding.operatorId,
        allocationId: payload.allocation.allocationId,
        receiptId: payload.receiptId,
        priorActivation: "none",
        incidentEvidence: payload.binding.incidentEvidence,
        requiredBases: [
          { code: "A", purpose: "standard" },
          { code: "FF", purpose: "full" },
          { code: "R", purpose: "rectificative" },
        ],
      };
      const trustPath = join(root, "trust.json");
      const confirmationPath = join(root, "current.json");
      await writeFile(
        trustPath,
        JSON.stringify({
          issuer: fixture.trust.issuer,
          fingerprint: fixture.receipt.keyId,
          publicKey: fixture.trust.keys.get(fixture.receipt.keyId),
        }),
      );
      await writeFile(confirmationPath, JSON.stringify(confirmation));
      const original = await readFile(confirmationPath);
      const environment = {
        WAITRON_FISCAL_CLOUD_TRUST_FILE: trustPath,
        WAITRON_FISCAL_CLOUD_FINGERPRINT: fixture.receipt.keyId,
        WAITRON_FISCAL_CONFIRMATION_FILE: confirmationPath,
        WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY: root,
      };
      for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
      const operations =
        mode === "ambient"
          ? FISCAL_OPERATIONS
          : FISCAL_OPERATIONS.configure!({
              environment,
              readPublicEvidence: async () => undefined,
            });
      const input = {
        allocation: payload.allocation,
        approval: payload.approval,
        receipt: fixture.packet,
      };
      await withOperationAuthority(binding, payload.binding.operatorId, async (authority) => {
        await expect(
          operations.prepare({ binding, authority, input }, async () => "admitted"),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "outside_confirmation_missing" },
        });
        expect(await readFile(confirmationPath)).toEqual(original);
        expect((await readdir(root)).sort()).toEqual(["current.json", "trust.json"]);
        const historical = createCloudAllocationFilePreparation({
          trustPath,
          confirmedFingerprint: fixture.receipt.keyId,
          confirmationPath,
          receiptDirectory: root,
        });
        expect(
          await historical.prepare(
            { binding, authority, input },
            async () => "valid historical fixture",
          ),
        ).toBe("valid historical fixture");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
