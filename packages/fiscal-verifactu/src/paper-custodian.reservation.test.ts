import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPaperCustodian } from "./paper-custodian.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  verifyPaperReservation,
} from "./paper-evidence.js";

const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const allocation = {
  version: 1,
  allocationId: "allocation-42",
  taxpayerNif: "B12345678",
  softwareId: "WT",
  environment: "preproduction",
  installationIdentity: "P000042",
  series: [{ code: "A-P000042", purpose: "standard" }],
  source: "paper",
  issuedAt: "2026-10-12T08:00:00.000Z",
};
const block = signPaperBlock(
  {
    version: 1,
    custodianId: "custodian",
    generationId: "generation-1",
    blockId: "block-1",
    packVersion: 1,
    recipientVenueId: "venue-1",
    allocations: [allocation],
  },
  privateKey,
);
const event = {
  eventId: "join-1",
  operatorId: "administrator",
  sourceId: "primary-node",
  targetNodeId: "standby-node",
  incidentEvidence: "master-register/join-1",
  reservedAt: "2026-10-12T09:00:00.000Z",
};

async function fixture(
  test: (
    dir: string,
    args: string[],
    run: (args: string[]) => Promise<number>,
    out: string[],
    err: string[],
  ) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "waitron-paper-reservation-"));
  const out: string[] = [],
    err: string[] = [];
  try {
    await writeFile(join(dir, "key.pem"), privateKey, { mode: 0o600 });
    await writeFile(join(dir, "block.json"), JSON.stringify(block));
    await writeFile(join(dir, "event.json"), JSON.stringify(event));
    const args = [
      "sign-reservation",
      "--key",
      join(dir, "key.pem"),
      "--block",
      join(dir, "block.json"),
      "--allocation",
      "allocation-42",
      "--input",
      join(dir, "event.json"),
      "--output",
      join(dir, "reservation.json"),
      "--current-register-confirmed",
      "--reserved-outside",
    ];
    await test(
      dir,
      args,
      (argv) =>
        runPaperCustodian(argv, {
          stdout: (line) => out.push(line),
          stderr: (line) => err.push(line),
        }),
      out,
      err,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("the custodian's dormant standby reservation command", () => {
  it("creates a verifiable target-bound reservation without a consumption receipt", async () => {
    await fixture(async (dir, args, run, out, err) => {
      expect(await run(args)).toBe(0);
      const receipt = JSON.parse(await readFile(join(dir, "reservation.json"), "utf8"));
      expect(
        verifyPaperReservation({ block, reservation: receipt }, trust, {
          allocationId: "allocation-42",
          taxpayerNif: "B12345678",
          softwareId: "WT",
          environment: "preproduction",
          recipientVenueId: "venue-1",
          generationId: "generation-1",
          blockId: "block-1",
          ...event,
          currentRegisterConfirmed: true,
          reservationConfirmed: true,
          currentEntryState: "reserved",
          requiredBases: [{ code: "A", purpose: "standard" }],
        }),
      ).toEqual({
        ok: true,
        allocation,
        reservation: {
          version: 1,
          custodianId: "custodian",
          blockDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          allocationId: "allocation-42",
          ...event,
        },
      });
      expect(receipt.payload).not.toHaveProperty("consumedAt");
      expect((await stat(join(dir, "reservation.json"))).mode & 0o777).toBe(0o600);
      expect(out).toEqual([]);
      expect(err).toEqual([]);
    });
  });

  it.each(["--current-register-confirmed", "--reserved-outside"])(
    "requires the outside confirmation %s",
    async (flag) => {
      await fixture(async (dir, args, run, out, err) => {
        expect(await run(args.filter((arg) => arg !== flag))).toBe(2);
        expect(existsSync(join(dir, "reservation.json"))).toBe(false);
        expect(out).toEqual([]);
        expect(err).toEqual(["Invalid paper custodian arguments"]);
      });
    },
  );

  it("does not treat outside consumption as a standby reservation", async () => {
    await fixture(async (dir, args, run, out, err) => {
      expect(
        await run(args.map((arg) => (arg === "--reserved-outside" ? "--consumed-outside" : arg))),
      ).toBe(2);
      expect(existsSync(join(dir, "reservation.json"))).toBe(false);
      expect(out).toEqual([]);
      expect(err).toEqual(["Invalid paper custodian arguments"]);
    });
  });

  it("does not overwrite the evidence for a previously reserved standby", async () => {
    await fixture(async (dir, args, run, out, err) => {
      await writeFile(join(dir, "reservation.json"), "retained-proof");
      expect(await run(args)).toBe(1);
      expect(await readFile(join(dir, "reservation.json"), "utf8")).toBe("retained-proof");
      expect(out).toEqual([]);
      expect(err).toEqual(["Paper custodian command failed (Error)"]);
    });
  });

  it("does not expose the key when a submitted event is malformed", async () => {
    await fixture(async (dir, args, run, out, err) => {
      await writeFile(
        join(dir, "event.json"),
        JSON.stringify({ ...event, targetNodeId: event.sourceId }),
      );
      expect(await run(args)).toBe(1);
      expect(existsSync(join(dir, "reservation.json"))).toBe(false);
      expect(out).toEqual([]);
      expect(err).toEqual(["Paper custodian command failed (RangeError)"]);
    });
  });
});
