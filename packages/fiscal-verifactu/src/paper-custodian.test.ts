import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as command from "./paper-custodian.js";
import { verifyPaperEvidence } from "./paper-evidence.js";

async function fixture(
  test: (
    dir: string,
    run: (args: string[]) => Promise<number | undefined>,
    out: string[],
    err: string[],
  ) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "waitron-paper-custodian-"));
  const out: string[] = [];
  const err: string[] = [];
  try {
    await test(
      dir,
      async (args) =>
        command.runPaperCustodian(args, {
          stdout: (line: string) => out.push(line),
          stderr: (line: string) => err.push(line),
        }),
      out,
      err,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const allocation = {
  version: 1,
  allocationId: "paper-42",
  taxpayerNif: "B12345678",
  softwareId: "WT",
  environment: "preproduction",
  installationIdentity: "P000042",
  series: [{ code: "A-P000042", purpose: "standard" }],
  source: "paper",
  issuedAt: "2026-10-12T08:00:00.000Z",
};
const block = {
  version: 1,
  custodianId: "register-custodian",
  generationId: "generation-1",
  blockId: "block-1",
  packVersion: 1,
  recipientVenueId: "venue-madrid",
  allocations: [allocation],
};
const event = {
  eventId: "restore-1",
  operatorId: "administrator",
  sourceId: "backup-1",
  targetNodeId: "new-node",
  incidentEvidence: "master-register/restore-1",
  consumedAt: "2026-10-12T09:00:00.000Z",
};

describe("the paper custodian's separate command", () => {
  it("creates an Ed25519 private key with owner-only mode and prints only its public trust", async () => {
    await fixture(async (dir, run, out, err) => {
      const keyPath = join(dir, "custodian.pem");
      expect(await run(["keygen", "--custodian", "register-custodian", "--key", keyPath])).toBe(0);
      const secret = await readFile(keyPath, "utf8");
      const privateKey = createPrivateKey(secret);
      expect(privateKey.asymmetricKeyType).toBe("ed25519");
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
      const published = JSON.parse(out[0]!);
      expect(published).toEqual({
        custodianId: "register-custodian",
        publicKey: createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString(),
        fingerprint: createHash("sha256")
          .update(createPublicKey(privateKey).export({ type: "spki", format: "der" }))
          .digest("hex"),
      });
      expect(out.join("\n")).not.toContain("PRIVATE KEY");
      expect(err).toEqual([]);
    });
  });

  it("never replaces an existing custodian key", async () => {
    await fixture(async (dir, run, out, err) => {
      const keyPath = join(dir, "existing.pem");
      await writeFile(keyPath, "existing-custodian-key");
      expect(await run(["keygen", "--custodian", "register-custodian", "--key", keyPath])).toBe(1);
      expect(await readFile(keyPath, "utf8")).toBe("existing-custodian-key");
      expect(out).toEqual([]);
      expect(err).toEqual(["Paper custodian command failed (Error)"]);
    });
  });

  it("signs a reserved block and a marked consumption into public files that the verifier accepts", async () => {
    await fixture(async (dir, run, out, err) => {
      const keyPath = join(dir, "custodian.pem");
      expect(await run(["keygen", "--custodian", "register-custodian", "--key", keyPath])).toBe(0);
      const trust = JSON.parse(out[0]!);
      const blockPath = join(dir, "block.json");
      const signedPath = join(dir, "signed-block.json");
      const eventPath = join(dir, "event.json");
      const receiptPath = join(dir, "consumption.json");
      await writeFile(blockPath, JSON.stringify(block));
      await writeFile(eventPath, JSON.stringify(event));
      expect(
        await run([
          "sign-block",
          "--key",
          keyPath,
          "--input",
          blockPath,
          "--output",
          signedPath,
          "--reserved-outside",
        ]),
      ).toBe(0);
      expect(
        await run([
          "sign-consumption",
          "--key",
          keyPath,
          "--block",
          signedPath,
          "--allocation",
          "paper-42",
          "--input",
          eventPath,
          "--output",
          receiptPath,
          "--current-register-confirmed",
          "--consumed-outside",
        ]),
      ).toBe(0);
      const signedBlock = JSON.parse(await readFile(signedPath, "utf8"));
      const signedConsumption = JSON.parse(await readFile(receiptPath, "utf8"));
      expect(
        verifyPaperEvidence({ block: signedBlock, consumption: signedConsumption }, trust, {
          ...event,
          allocationId: "paper-42",
          taxpayerNif: "B12345678",
          softwareId: "WT",
          environment: "preproduction",
          recipientVenueId: "venue-madrid",
          generationId: "generation-1",
          blockId: "block-1",
          currentRegisterConfirmed: true,
          consumptionConfirmed: true,
          requiredBases: [{ code: "A", purpose: "standard" }],
        }),
      ).toEqual({ ok: true, allocation });
      expect(signedConsumption.payload.blockDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(
        verify(
          null,
          Buffer.from(
            JSON.stringify([
              "waitron.paper-consumption",
              1,
              "register-custodian",
              signedConsumption.payload.blockDigest,
              "paper-42",
              "restore-1",
              "administrator",
              "backup-1",
              "new-node",
              "master-register/restore-1",
              "2026-10-12T09:00:00.000Z",
            ]),
          ),
          trust.publicKey,
          Buffer.from(signedConsumption.signature, "base64url"),
        ),
      ).toBe(true);
      expect(JSON.stringify({ signedBlock, signedConsumption, out, err })).not.toContain(
        "PRIVATE KEY",
      );
      expect(err).toEqual([]);
    });
  });

  it.each([
    [],
    ["unknown"],
    ["keygen"],
    ["keygen", "--custodian", "", "--key", "key.pem"],
    ["keygen", "--custodian", "register-custodian", "--key", ""],
    ["keygen", "--custodian", "register-custodian", "--key", "key.pem", "--private-key=secret"],
    ["sign-block", "--key", "key.pem", "--input", "block.json", "--output", "signed.json"],
    [
      "sign-consumption",
      "--key",
      "key.pem",
      "--block",
      "signed.json",
      "--allocation",
      "paper-42",
      "--input",
      "event.json",
      "--output",
      "receipt.json",
      "--consumed-outside",
    ],
  ])(
    "requires named file paths and outside confirmations before any file write: %j",
    async (...args: string[]) => {
      await fixture(async (_dir, run, out, err) => {
        expect(await run(args)).toBe(2);
        expect(out).toEqual([]);
        expect(err).toEqual(["Invalid paper custodian arguments"]);
      });
    },
  );
});

describe("paper custodian process entry", () => {
  it("executes the supplied keygen arguments and returns only public trust on stdout", async () => {
    await fixture(async (dir) => {
      const keyPath = join(dir, "entry.pem");
      const previousArgs = process.argv;
      const previousExit = process.exitCode;
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        vi.resetModules();
        process.argv = [
          process.execPath,
          "paper-custodian-bin.js",
          "keygen",
          "--custodian",
          "register-custodian",
          "--key",
          keyPath,
        ];
        await import("./paper-custodian-bin.js");
        expect(existsSync(keyPath)).toBe(true);
        expect(process.exitCode).toBe(0);
        expect(stdout.mock.calls).toHaveLength(1);
        expect(JSON.parse(stdout.mock.calls[0]![0] as string)).toMatchObject({
          custodianId: "register-custodian",
        });
        expect(stdout.mock.calls[0]![0]).not.toContain("PRIVATE KEY");
        expect(stderr).not.toHaveBeenCalled();
      } finally {
        process.argv = previousArgs;
        process.exitCode = previousExit;
        stdout.mockRestore();
        stderr.mockRestore();
      }
    });
  });

  it("returns usage status on stderr for missing arguments", async () => {
    const previousArgs = process.argv;
    const previousExit = process.exitCode;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      vi.resetModules();
      process.argv = [process.execPath, "paper-custodian-bin.js"];
      await import("./paper-custodian-bin.js");
      expect(process.exitCode).toBe(2);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith("Invalid paper custodian arguments\n");
    } finally {
      process.argv = previousArgs;
      process.exitCode = previousExit;
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});

describe("paper custodian refusal qualification", () => {
  it.each([
    "unknown-allocation",
    "changed-block",
    "malformed-event",
    "event-json",
    "missing-key",
    "existing-output",
  ])("leaves no new consumption output for %s", async (cause) => {
    await fixture(async (dir, run, out, err) => {
      const keyPath = join(dir, "custodian.pem");
      const blockPath = join(dir, "block.json");
      const signedPath = join(dir, "signed.json");
      const eventPath = join(dir, "event.json");
      const output = join(dir, "consumed.json");
      expect(await run(["keygen", "--custodian", "register-custodian", "--key", keyPath])).toBe(0);
      await writeFile(blockPath, JSON.stringify(block));
      expect(
        await run([
          "sign-block",
          "--key",
          keyPath,
          "--input",
          blockPath,
          "--output",
          signedPath,
          "--reserved-outside",
        ]),
      ).toBe(0);
      await writeFile(
        eventPath,
        cause === "event-json"
          ? "malformed-secret-content"
          : JSON.stringify(
              cause === "malformed-event" ? { ...event, privateKey: "must-not-appear" } : event,
            ),
      );
      if (cause === "changed-block") {
        const changed = JSON.parse(await readFile(signedPath, "utf8"));
        changed.payload.recipientVenueId = "different-venue";
        await writeFile(signedPath, JSON.stringify(changed));
      }
      if (cause === "existing-output") await writeFile(output, "old-committed-receipt");
      expect(
        await run([
          "sign-consumption",
          "--key",
          cause === "missing-key" ? join(dir, "absent.pem") : keyPath,
          "--block",
          signedPath,
          "--allocation",
          cause === "unknown-allocation" ? "outside-block" : "paper-42",
          "--input",
          eventPath,
          "--output",
          output,
          "--current-register-confirmed",
          "--consumed-outside",
        ]),
      ).toBe(1);
      if (cause === "existing-output")
        expect(await readFile(output, "utf8")).toBe("old-committed-receipt");
      else expect(existsSync(output)).toBe(false);
      expect(out).toHaveLength(1);
      expect(err).toEqual([
        cause === "event-json"
          ? "Paper custodian command failed (SyntaxError)"
          : cause === "missing-key" || cause === "existing-output"
            ? "Paper custodian command failed (Error)"
            : "Paper custodian command failed (RangeError)",
      ]);
    });
  });

  it("requires the independent register confirmation in addition to a consumption mark", async () => {
    await fixture(async (_dir, run, out, err) => {
      expect(
        await run([
          "sign-consumption",
          "--key",
          "key.pem",
          "--block",
          "block.json",
          "--allocation",
          "paper-42",
          "--input",
          "event.json",
          "--output",
          "receipt.json",
          "--consumed-outside",
        ]),
      ).toBe(2);
      expect(out).toEqual([]);
      expect(err).toEqual(["Invalid paper custodian arguments"]);
    });
  });

  it("refuses an invalid custodian name before creating a key", async () => {
    await fixture(async (dir, run, out, err) => {
      const keyPath = join(dir, "key.pem");
      expect(await run(["keygen", "--custodian", "invalid\nname", "--key", keyPath])).toBe(2);
      expect(existsSync(keyPath)).toBe(false);
      expect(out).toEqual([]);
      expect(err).toEqual(["Invalid paper custodian arguments"]);
    });
  });
});

describe("recovering the custodian's public trust file", () => {
  it("prints the existing key's public trust without replacing or exposing the private key", async () => {
    await fixture(async (dir, run, out, err) => {
      const keyPath = join(dir, "custodian.pem");
      expect(await run(["keygen", "--custodian", "register-custodian", "--key", keyPath])).toBe(0);
      const secretBefore = await readFile(keyPath, "utf8");
      const publicBefore = out[0]!;
      out.length = 0;
      expect(await run(["public", "--custodian", "register-custodian", "--key", keyPath])).toBe(0);
      expect(out).toEqual([publicBefore]);
      expect(out.join("\n")).not.toContain("PRIVATE KEY");
      expect(await readFile(keyPath, "utf8")).toBe(secretBefore);
      expect(err).toEqual([]);
    });
  });
});

it("reports an unexpected output failure without printing its secret-bearing thrown value", async () => {
  await fixture(async (dir, _run, _out, err) => {
    const keyPath = join(dir, "key.pem");
    const status = await command.runPaperCustodian(
      ["keygen", "--custodian", "register-custodian", "--key", keyPath],
      {
        stdout: () => {
          throw "secret-bearing-output-failure";
        },
        stderr: (line) => err.push(line),
      },
    );
    expect(status).toBe(1);
    expect(createPrivateKey(await readFile(keyPath, "utf8")).asymmetricKeyType).toBe("ed25519");
    expect(err).toEqual(["Paper custodian command failed (UnknownError)"]);
  });
});

it.each(["--reserved-outside", "--current-register-confirmed", "--consumed-outside"])(
  "refuses a missing %s with otherwise usable files",
  async (missing) => {
    await fixture(async (dir, run, _out, err) => {
      const key = join(dir, "key.pem");
      const input = join(dir, "block.json");
      const signed = join(dir, "signed.json");
      const eventPath = join(dir, "event.json");
      const output = join(dir, "output.json");
      expect(await run(["keygen", "--custodian", "register-custodian", "--key", key])).toBe(0);
      await writeFile(input, JSON.stringify(block));
      await writeFile(eventPath, JSON.stringify(event));
      expect(
        await run([
          "sign-block",
          "--key",
          key,
          "--input",
          input,
          "--output",
          signed,
          "--reserved-outside",
        ]),
      ).toBe(0);
      const args =
        missing === "--reserved-outside"
          ? ["sign-block", "--key", key, "--input", input, "--output", output]
          : [
              "sign-consumption",
              "--key",
              key,
              "--block",
              signed,
              "--allocation",
              "paper-42",
              "--input",
              eventPath,
              "--output",
              output,
              "--current-register-confirmed",
              "--consumed-outside",
            ].filter((value) => value !== missing);
      expect(await run(args)).toBe(2);
      expect(existsSync(output)).toBe(false);
      expect(err).toEqual(["Invalid paper custodian arguments"]);
    });
  },
);
