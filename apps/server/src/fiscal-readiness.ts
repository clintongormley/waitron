import { createHash } from "node:crypto";
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
  certificateFingerprint: string | null;
  certificateKind: string | null;
  moduleVersions: Record<string, number>;
  applicationVersion: string;
}

export type FiscalTestStatus = "accepted" | "rejected" | "uncertain";
export type FiscalReadinessResult =
  { status: FiscalTestStatus; testedAt?: string } | { status: "not-applicable" };

type Evidence = { version: 1; binding: string; testedAt: string; status: "accepted" };

export function fiscalReadinessBinding(input: FiscalReadinessInput): string {
  const normalized = {
    ...input,
    moduleVersions: Object.fromEntries(
      Object.entries(input.moduleVersions).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function readEvidence(stateDir: string): Promise<Evidence | null> {
  try {
    const value = JSON.parse(
      await readFile(join(stateDir, EVIDENCE_FILE), "utf8"),
    ) as Partial<Evidence>;
    return value.version === 1 &&
      value.status === "accepted" &&
      typeof value.binding === "string" &&
      typeof value.testedAt === "string"
      ? (value as Evidence)
      : null;
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
): {
  run(input: FiscalReadinessInput): Promise<FiscalReadinessResult>;
  assertReady(input: FiscalReadinessInput): Promise<void>;
} {
  return {
    async run(input) {
      if (input.requirement === "not-applicable") return { status: "not-applicable" };
      const binding = fiscalReadinessBinding(input);
      const existing = await readEvidence(stateDir);
      if (existing?.binding === binding) {
        return { status: "accepted", testedAt: existing.testedAt };
      }
      const status = await submit(input);
      if (status !== "accepted") return { status };
      const testedAt = new Date().toISOString();
      await writeFileAtomic(
        join(stateDir, EVIDENCE_FILE),
        JSON.stringify({ version: 1, binding, testedAt, status: "accepted" } satisfies Evidence),
        0o600,
      );
      return { status, testedAt };
    },
    async assertReady(input) {
      if (input.requirement === "not-applicable") return;
      const evidence = await readEvidence(stateDir);
      if (evidence?.binding !== fiscalReadinessBinding(input)) {
        throw new AppError("setup.fiscal_test_required", { module: input.fiscalModule });
      }
    },
  };
}
