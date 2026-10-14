import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as sources from "./allocation-paper-source.js";
import { paperCustodianFingerprint } from "./paper-evidence.js";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const custodian = { custodianId: "standby-custodian", publicKey, fingerprint };
const request = {
  binding: {
    module: "fiscal-verifactu",
    action: "reserve",
    eventId: "join-spare-42",
    sourceId: "primary-1",
    targetNodeId: "spare-1",
  },
  operatorId: "administrator",
};
const confirmation = {
  version: 1,
  allocationId: "spare-allocation-42",
  ...request,
  incidentEvidence: "current-master/join-spare-42",
  recipientVenueId: "spare-venue",
  generationId: "generation-1",
  blockId: "spare-block",
  currentRegisterConfirmed: true,
  reservationConfirmed: true,
  currentEntryState: "reserved",
};
async function withFiles(
  run: (paths: {
    custodianPath: string;
    confirmationPath: string;
    confirmedFingerprint: string;
  }) => Promise<void>,
) {
  const folder = await mkdtemp(join(tmpdir(), "standby-allocation-source-"));
  try {
    const paths = {
      custodianPath: join(folder, "public.json"),
      confirmationPath: join(folder, "current.json"),
      confirmedFingerprint: fingerprint,
    };
    await writeFile(paths.custodianPath, JSON.stringify(custodian));
    await writeFile(paths.confirmationPath, JSON.stringify(confirmation));
    await run(paths);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
function refusal(reason: string) {
  return { code: "sif.allocation_invalid", params: { reason } };
}

it("reads independently configured public trust and the current standby reservation", async () =>
  withFiles(async (paths) => {
    const source = sources.createPaperStandbySource(paths);
    expect(await source(request)).toEqual({
      ...request,
      evidence: {
        trust: custodian,
        allocationId: "spare-allocation-42",
        incidentEvidence: "current-master/join-spare-42",
        recipientVenueId: "spare-venue",
        generationId: "generation-1",
        blockId: "spare-block",
        currentRegisterConfirmed: true,
        reservationConfirmed: true,
        currentEntryState: "reserved",
      },
    });
  }));

it.each(["currentRegisterConfirmed", "reservationConfirmed"] as const)(
  "requires current %s before returning the reservation evidence",
  async (field) =>
    withFiles(async (paths) => {
      await writeFile(paths.confirmationPath, JSON.stringify({ ...confirmation, [field]: false }));
      await expect(sources.createPaperStandbySource(paths)(request)).rejects.toMatchObject(
        refusal("outside_confirmation_missing"),
      );
    }),
);

it.each(["consumed-for-event", "consumed-elsewhere", "retired", "abandoned"])(
  "refuses an outside entry that has become %s",
  async (state) =>
    withFiles(async (paths) => {
      await writeFile(
        paths.confirmationPath,
        JSON.stringify({ ...confirmation, currentEntryState: state }),
      );
      await expect(sources.createPaperStandbySource(paths)(request)).rejects.toMatchObject(
        refusal("reservation_not_current"),
      );
    }),
);

it.each(["another event", "another operator"])("refuses a current statement for %s", async (kind) =>
  withFiles(async (paths) => {
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({
        ...confirmation,
        ...(kind === "another event"
          ? { binding: { ...request.binding, eventId: "other" } }
          : { operatorId: "other" }),
      }),
    );
    await expect(sources.createPaperStandbySource(paths)(request)).rejects.toMatchObject(
      refusal("event_mismatch"),
    );
  }),
);

it("requires a fresh establishment statement instead of replaying the bundle's reserve scope", async () =>
  withFiles(async (paths) => {
    const establish = { ...request, binding: { ...request.binding, action: "establish" } };
    const source = sources.createPaperStandbySource(paths);
    await expect(source(establish)).rejects.toMatchObject(refusal("event_mismatch"));
    await writeFile(paths.confirmationPath, JSON.stringify({ ...confirmation, ...establish }));
    expect((await source(establish))?.binding.action).toBe("establish");
  }));

it("requires an independently confirmed fingerprint", async () =>
  withFiles(async (paths) => {
    await expect(
      sources.createPaperStandbySource({ ...paths, confirmedFingerprint: "0".repeat(64) })(request),
    ).rejects.toMatchObject(refusal("reservation_untrusted"));
  }));

it("rereads current authority rather than caching a reserved entry", async () =>
  withFiles(async (paths) => {
    const source = sources.createPaperStandbySource(paths);
    expect((await source(request))?.evidence.allocationId).toBe("spare-allocation-42");
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, currentEntryState: "abandoned" }),
    );
    await expect(source(request)).rejects.toMatchObject(refusal("reservation_not_current"));
  }));

it.each(["allocationId", "incidentEvidence", "recipientVenueId", "generationId", "blockId"])(
  "refuses a blank %s",
  async (field) =>
    withFiles(async (paths) => {
      await writeFile(paths.confirmationPath, JSON.stringify({ ...confirmation, [field]: "" }));
      await expect(sources.createPaperStandbySource(paths)(request)).rejects.toMatchObject(
        refusal("outside_confirmation_missing"),
      );
    }),
);

it.each(["version", "state", "extra", "missing", "null", "invalid JSON", "oversized"])(
  "refuses %s current statements",
  async (kind) =>
    withFiles(async (paths) => {
      const malformed =
        kind === "version"
          ? { ...confirmation, version: 2 }
          : kind === "state"
            ? { ...confirmation, currentEntryState: "unknown" }
            : kind === "extra"
              ? { ...confirmation, consumptionConfirmed: true }
              : kind === "missing"
                ? { ...confirmation, reservationConfirmed: undefined }
                : kind === "null"
                  ? null
                  : confirmation;
      await writeFile(
        paths.confirmationPath,
        kind === "invalid JSON"
          ? "{"
          : kind === "oversized"
            ? " ".repeat(65537) + JSON.stringify(malformed)
            : JSON.stringify(malformed),
      );
      await expect(sources.createPaperStandbySource(paths)(request)).rejects.toMatchObject(
        refusal("outside_confirmation_missing"),
      );
    }),
);

it.each(["wrong fingerprint", "extra", "private key", "null", "missing", "oversized"])(
  "refuses %s custodian inputs",
  async (kind) =>
    withFiles(async (paths) => {
      const malformed =
        kind === "wrong fingerprint"
          ? { ...custodian, fingerprint: "0".repeat(64) }
          : kind === "extra"
            ? { ...custodian, signingKey: "unexpected" }
            : kind === "private key"
              ? {
                  ...custodian,
                  publicKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
                }
              : kind === "null"
                ? null
                : custodian;
      if (kind === "missing") await rm(paths.custodianPath);
      else
        await writeFile(
          paths.custodianPath,
          kind === "oversized"
            ? " ".repeat(65537) + JSON.stringify(malformed)
            : JSON.stringify(malformed),
        );
      await expect(sources.createPaperStandbySource(paths)(request)).rejects.toMatchObject(
        refusal("reservation_untrusted"),
      );
    }),
);

it.each(["custodianPath", "confirmationPath"] as const)(
  "refuses an empty %s rather than reading the working directory",
  async (field) =>
    withFiles(async (paths) => {
      await expect(
        sources.createPaperStandbySource({ ...paths, [field]: "" })(request),
      ).rejects.toMatchObject(
        refusal(
          field === "custodianPath" ? "reservation_untrusted" : "outside_confirmation_missing",
        ),
      );
    }),
);
