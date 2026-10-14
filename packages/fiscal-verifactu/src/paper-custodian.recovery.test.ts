import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPaperCustodian } from "./paper-custodian.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";

const targetNodeId = "c0000000-0000-4000-8000-000000000001";
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "outside-recovery-42",
  sourceId: "selected-archive-digest",
  targetNodeId,
};
const operatorId = { kind: "recovery-key", nodeId: targetNodeId, eventId: binding.eventId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const allocation = {
  version: 1 as const,
  allocationId: "paper-42",
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
  issuedAt: "2026-10-14T08:00:00.000Z",
};
const approval = {
  version: 1,
  eventId: binding.eventId,
  sourceId: binding.sourceId,
  targetNodeId,
  operatorId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-14T09:00:00.000Z",
  incidentEvidence: "outside/incident-42",
};

async function fixture(
  run: (
    files: Record<string, string>,
    args: string[],
    out: string[],
    err: string[],
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "waitron-paper-recovery-export-"));
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const fingerprint = paperCustodianFingerprint(publicKey)!;
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "outside-custodian",
      generationId: "generation-2",
      blockId: "block-2",
      packVersion: 1,
      recipientVenueId: "venue-madrid",
      allocations: [allocation],
    },
    privateKey,
  );
  const consumption = signPaperConsumptionForBlock(
    block,
    "paper-42",
    {
      eventId: binding.eventId,
      operatorId,
      sourceId: binding.sourceId,
      targetNodeId,
      incidentEvidence: approval.incidentEvidence,
      consumedAt: approval.confirmedAt,
    },
    privateKey,
  );
  const values = {
    block,
    consumption,
    input: approval,
    custodian: { custodianId: "outside-custodian", publicKey, fingerprint },
    confirmation: {
      version: 1,
      allocationId: "paper-42",
      binding,
      operatorId,
      priorActivation: "none",
      incidentEvidence: approval.incidentEvidence,
      requiredBases: bases,
      recipientVenueId: "venue-madrid",
      generationId: "generation-2",
      blockId: "block-2",
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    },
  };
  const files: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    files[name] = join(root, `${name}.json`);
    await writeFile(files[name]!, JSON.stringify(value));
  }
  files.output = join(root, "operation.json");
  const args = [
    "prepare-recovery",
    ...Object.entries(files).flatMap(([name, path]) => [`--${name}`, path]),
    "--fingerprint",
    fingerprint,
    "--taxpayer",
    "89890001K",
    "--environment",
    "preproduction",
    "--action",
    "restore",
  ];
  try {
    await run(files, args, [], []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("exports a complete public paper restore operation without signing or recovery secrets", async () => {
  await fixture(async (files, args, out, err) => {
    const outsideBefore = await readFile(files.confirmation!, "utf8");
    expect(
      await runPaperCustodian(args, {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      }),
    ).toBe(0);
    const bytes = await readFile(files.output!, "utf8");
    expect(JSON.parse(bytes)).toEqual({
      binding,
      input: {
        allocation: {
          ...allocation,
          reservationEvidence: {
            block: JSON.parse(await readFile(files.block!, "utf8")),
            consumption: JSON.parse(await readFile(files.consumption!, "utf8")),
          },
        },
        approval,
      },
    });
    expect(bytes).not.toContain("PRIVATE KEY");
    expect(bytes).not.toContain("fingerprint");
    expect((await stat(files.output!)).mode & 0o777).toBe(0o600);
    expect(await readFile(files.confirmation!, "utf8")).toBe(outsideBefore);
    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });
});

it("refuses to overwrite a retained operation", async () => {
  await fixture(async (files, args, _out, err) => {
    await writeFile(files.output!, "retained-public-operation");
    expect(
      await runPaperCustodian(args, { stdout: () => {}, stderr: (line) => err.push(line) }),
    ).toBe(1);
    expect(await readFile(files.output!, "utf8")).toBe("retained-public-operation");
    expect(err).toEqual(["Paper custodian command failed (Error)"]);
  });
});

it("exports re-registration only with its own current outside action binding", async () => {
  await fixture(async (files, args, out, err) => {
    args[args.indexOf("--action") + 1] = "re-register";
    const current = JSON.parse(await readFile(files.confirmation!, "utf8"));
    await writeFile(
      files.confirmation!,
      JSON.stringify({ ...current, binding: { ...binding, action: "re-register" } }),
    );
    expect(
      await runPaperCustodian(args, {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      }),
    ).toBe(0);
    expect(JSON.parse(await readFile(files.output!, "utf8")).binding).toEqual({
      ...binding,
      action: "re-register",
    });
    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });
});

it("requires fresh outside evidence again after a completed export", async () => {
  await fixture(async (files, args, out, err) => {
    const io = {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
    };
    expect(await runPaperCustodian(args, io)).toBe(0);
    await rm(files.output!);
    await rm(files.confirmation!);
    expect(await runPaperCustodian(args, io)).toBe(1);
    expect(existsSync(files.output!)).toBe(false);
    expect(out).toEqual([]);
    expect(err).toEqual(["Paper custodian command failed (AppError)"]);
  });
});

it("refuses an old block after the outside register records another generation", async () => {
  await fixture(async (files, args, _out, err) => {
    const current = JSON.parse(await readFile(files.confirmation!, "utf8"));
    await writeFile(
      files.confirmation!,
      JSON.stringify({ ...current, generationId: "generation-3" }),
    );
    expect(
      await runPaperCustodian(args, { stdout: () => {}, stderr: (line) => err.push(line) }),
    ).toBe(1);
    expect(existsSync(files.output!)).toBe(false);
    expect(err).toEqual(["Paper custodian command failed (RangeError)"]);
  });
});

it.each([
  ["taxpayer", "B12345678"],
  ["environment", "production"],
  ["environment", "dev"],
  ["action", "setup"],
  ["fingerprint", "0".repeat(64)],
])(
  "refuses the independently selected %s=%s without creating an operation",
  async (field, value) => {
    await fixture(async (files, args, out, err) => {
      args[args.indexOf(`--${field}`) + 1] = value;
      expect(
        await runPaperCustodian(args, {
          stdout: (line) => out.push(line),
          stderr: (line) => err.push(line),
        }),
      ).toBe(1);
      expect(existsSync(files.output!)).toBe(false);
      expect(out).toEqual([]);
      expect(err).toHaveLength(1);
      expect(err[0]).toMatch(/^Paper custodian command failed \((?:RangeError|AppError)\)$/);
    });
  },
);

it.each([
  ["priorActivation", "uncertain"],
  ["priorActivation", "committed"],
  ["currentEntryState", "retired"],
  ["currentEntryState", "consumed-elsewhere"],
  ["currentEntryState", "reserved"],
  ["currentEntryState", "abandoned"],
  ["currentRegisterConfirmed", false],
  ["consumptionConfirmed", false],
  ["allocationId", "not-in-this-block"],
  ["blockId", "another-block"],
  ["requiredBases", [{ code: "A", purpose: "standard" }]],
])("keeps the current outside %s refusal effective for an export", async (field, value) => {
  await fixture(async (files, args, _out, err) => {
    const current = JSON.parse(await readFile(files.confirmation!, "utf8"));
    await writeFile(files.confirmation!, JSON.stringify({ ...current, [field]: value }));
    expect(
      await runPaperCustodian(args, { stdout: () => {}, stderr: (line) => err.push(line) }),
    ).toBe(1);
    expect(existsSync(files.output!)).toBe(false);
    expect(JSON.parse(await readFile(files.confirmation!, "utf8"))).toEqual({
      ...current,
      [field]: value,
    });
    expect(err).toEqual(["Paper custodian command failed (RangeError)"]);
  });
});

it.each([
  null,
  [],
  "secret-bearing-invalid-input",
  { ...approval, eventId: "" },
  { ...approval, sourceId: "a\nb" },
  { ...approval, sourceId: "x".repeat(257) },
  { ...approval, targetNodeId: "not-a-node-id" },
  { ...approval, operatorId: null },
  { ...approval, oldMachineOffline: false },
  { ...approval, oldMachineAbsent: true },
  { ...approval, noParallelRecovery: false },
  { ...approval, nodeRecoverySecret: "secret-bearing-invalid-input" },
])("refuses malformed or unsafe approval %j without exposing supplied contents", async (value) => {
  await fixture(async (files, args, out, err) => {
    await writeFile(files.input!, JSON.stringify(value));
    expect(
      await runPaperCustodian(args, {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      }),
    ).toBe(1);
    expect(existsSync(files.output!)).toBe(false);
    expect(out).toEqual([]);
    expect(err).toEqual(["Paper custodian command failed (RangeError)"]);
  });
});

it.each(["block", "consumption", "input"])(
  "bounds and validates the public %s file before an export",
  async (name) => {
    await fixture(async (files, args, _out, err) => {
      for (const contents of ["{secret-bearing-invalid-input", " ".repeat(65537)]) {
        await writeFile(files[name]!, contents);
        expect(
          await runPaperCustodian(args, { stdout: () => {}, stderr: (line) => err.push(line) }),
        ).toBe(1);
        expect(existsSync(files.output!)).toBe(false);
      }
      expect(err).toEqual([
        "Paper custodian command failed (SyntaxError)",
        "Paper custodian command failed (RangeError)",
      ]);
    });
  },
);

it.each(["block", "consumption", "input", "custodian", "confirmation"])(
  "refuses missing or directory input for %s without leaking a path or value",
  async (name) => {
    await fixture(async (files, args, out, err) => {
      await rm(files[name]!);
      for (const path of [files[name]!, join(files[name]!, "..")]) {
        args[args.indexOf(`--${name}`) + 1] = path;
        expect(
          await runPaperCustodian(args, {
            stdout: (line) => out.push(line),
            stderr: (line) => err.push(line),
          }),
        ).toBe(1);
        expect(existsSync(files.output!)).toBe(false);
      }
      expect(out).toEqual([]);
      expect(err).toHaveLength(2);
      expect(err.join("\n")).not.toContain(files[name]!);
    });
  },
);

it.each(["block", "consumption"])(
  "rejects a signed %s altered during manual transfer",
  async (name) => {
    await fixture(async (files, args, _out, err) => {
      const supplied = JSON.parse(await readFile(files[name]!, "utf8"));
      supplied.signature = "A".repeat(86);
      await writeFile(files[name]!, JSON.stringify(supplied));
      expect(
        await runPaperCustodian(args, { stdout: () => {}, stderr: (line) => err.push(line) }),
      ).toBe(1);
      expect(existsSync(files.output!)).toBe(false);
      expect(err).toEqual(["Paper custodian command failed (RangeError)"]);
    });
  },
);

it.each([
  "--custodian",
  "--confirmation",
  "--fingerprint",
  "--input",
  "--block",
  "--consumption",
  "--taxpayer",
  "--environment",
  "--action",
  "--output",
])("requires an explicit %s instead of using submitted or restored defaults", async (name) => {
  await fixture(async (files, args, out, err) => {
    args.splice(args.indexOf(name), 2);
    expect(
      await runPaperCustodian(args, {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      }),
    ).toBe(2);
    expect(existsSync(files.output!)).toBe(false);
    expect(out).toEqual([]);
    expect(err).toEqual(["Invalid paper custodian arguments"]);
  });
});
