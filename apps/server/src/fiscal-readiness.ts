import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { writeFileAtomic } from "./fs-atomic.js";
import "./errors.js";

const EVIDENCE_FILE = "fiscal-readiness.json";

export interface FiscalReadinessInput {
  requirement: "accepted-test-submission" | "not-applicable";
  fiscalModule: string;
  country: string;
  taxId: string;
  legalName: string;
  fiscalTerritory: string;
  submissionTarget: string | null;
  certificateFingerprint: string | null;
  certificateKind: string | null;
  moduleVersions: Record<string, number>;
  applicationVersion: string;
}

export type FiscalTestStatus = "accepted" | "rejected" | "uncertain";
export type FiscalReadinessResult =
  { status: FiscalTestStatus; testedAt?: string } | { status: "not-applicable" };

type Evidence = {
  version: 1;
  binding: string;
  testedAt: string;
  status: "accepted";
  mac: string;
};

export function fiscalReadinessBinding(input: FiscalReadinessInput): string {
  const normalized = {
    requirement: input.requirement,
    fiscalModule: input.fiscalModule,
    country: input.country,
    taxId: input.taxId,
    legalName: input.legalName,
    fiscalTerritory: input.fiscalTerritory,
    submissionTarget: input.submissionTarget,
    certificateFingerprint: input.certificateFingerprint,
    certificateKind: input.certificateKind,
    moduleVersions: Object.fromEntries(
      Object.entries(input.moduleVersions).sort(([a], [b]) => a.localeCompare(b)),
    ),
    applicationVersion: input.applicationVersion,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function evidenceMac(key: Buffer, evidence: Omit<Evidence, "mac">): string {
  return createHmac("sha256", key)
    .update(`${evidence.version}\n${evidence.binding}\n${evidence.testedAt}\n${evidence.status}`)
    .digest("hex");
}

async function readEvidence(stateDir: string, key: Buffer): Promise<Evidence | null> {
  try {
    const value = JSON.parse(
      await readFile(join(stateDir, EVIDENCE_FILE), "utf8"),
    ) as Partial<Evidence>;
    if (
      value.version === 1 &&
      value.status === "accepted" &&
      typeof value.binding === "string" &&
      typeof value.testedAt === "string" &&
      typeof value.mac === "string"
    ) {
      const expected = evidenceMac(key, {
        version: 1,
        binding: value.binding,
        testedAt: value.testedAt,
        status: "accepted",
      });
      const supplied = Buffer.from(value.mac, "hex");
      return supplied.length === 32 && timingSafeEqual(supplied, Buffer.from(expected, "hex"))
        ? (value as Evidence)
        : null;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

/** Store accepted test evidence locally. Rejected and uncertain attempts remain retryable and never
 * create the evidence that authorizes a production activation. */
export function createFiscalReadinessStore(
  stateDir: string,
  submit: (input: FiscalReadinessInput) => Promise<FiscalTestStatus>,
  evidenceKey: Buffer,
): {
  run(input: FiscalReadinessInput): Promise<FiscalReadinessResult>;
  assertReady(input: FiscalReadinessInput): Promise<void>;
} {
  return {
    async run(input) {
      if (input.requirement === "not-applicable") return { status: "not-applicable" };
      const binding = fiscalReadinessBinding(input);
      const existing = await readEvidence(stateDir, evidenceKey);
      if (existing?.binding === binding) {
        return { status: "accepted", testedAt: existing.testedAt };
      }
      const status = await submit(input);
      if (status !== "accepted") return { status };
      const testedAt = new Date().toISOString();
      const evidence = {
        version: 1,
        binding,
        testedAt,
        status: "accepted",
      } as const;
      await writeFileAtomic(
        join(stateDir, EVIDENCE_FILE),
        JSON.stringify({ ...evidence, mac: evidenceMac(evidenceKey, evidence) } satisfies Evidence),
        0o600,
      );
      return { status, testedAt };
    },
    async assertReady(input) {
      if (input.requirement === "not-applicable") return;
      const evidence = await readEvidence(stateDir, evidenceKey);
      if (evidence?.binding !== fiscalReadinessBinding(input)) {
        throw new AppError("setup.fiscal_test_required", { module: input.fiscalModule });
      }
    },
  };
}
