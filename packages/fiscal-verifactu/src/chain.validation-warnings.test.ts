import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationCode, ValidationIssue } from "@waitron/verifactu";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

// What `appendToChain` does with each warning `@waitron/verifactu` 0.2.1's `validate` can emit.
// Most of them cannot arise from a record Waitron builds, so the real `validate` runs and one
// extra warning is appended to its answer.
const injected = vi.hoisted(() => ({ issues: [] as ValidationIssue[] }));

vi.mock("@waitron/verifactu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/verifactu")>();
  return {
    ...real,
    validate: (...args: Parameters<typeof real.validate>) => [
      ...real.validate(...args),
      ...injected.issues,
    ],
  };
});

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let till: SeededTill;

beforeEach(async () => {
  till = await seedTill(suite.db, "A");
  injected.issues = [];
});

afterEach(() => {
  injected.issues = [];
});

function warning(code: ValidationCode): ValidationIssue {
  return { code, severity: "warning", field: `field-of-${code}`, message: "injected" };
}

async function append(
  alta = (saleId: Parameters<typeof altaFor>[1]) => altaFor(till.tillId, saleId, 1, 1),
) {
  const saleId = await seedSale(suite.db, till, 1);
  return withTransaction(suite.db, (tx) => appendToChain(tx, till.nodeId, alta(saleId)));
}

async function incidents() {
  const { rows } = await suite.db.execute<{ code: string; severity: string; params: string }>(
    sql`select code, severity, params from incidents order by code`,
  );
  return rows.map((row) => ({ ...row, params: JSON.parse(row.params) as unknown }));
}

describe("a totals warning files the record and flags the totals", () => {
  it.each<ValidationCode>(["CUOTA_TOTAL_MISMATCH", "IMPORTE_TOTAL_MISMATCH"])(
    "%s",
    async (code) => {
      injected.issues = [warning(code)];
      await append();

      expect(await suite.db.select().from(registrosFacturacion)).toHaveLength(1);
      expect(await incidents()).toEqual([
        {
          code: "fiscal.record_totals_disagree",
          severity: "warning",
          params: { fields: [`field-of-${code}`], codes: [code] },
        },
      ]);
    },
  );
});

describe("a malformed fingerprint warning refuses the record like an error", () => {
  it.each<ValidationCode>(["HUELLA_FORMAT", "HUELLA_ANTERIOR_FORMAT"])("%s", async (code) => {
    injected.issues = [warning(code)];
    await expect(append()).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: [`field-of-${code}`], codes: [code] },
    });

    expect(await suite.db.select().from(registrosFacturacion)).toEqual([]);
    expect(await incidents()).toEqual([]);
  });
});

describe("any other warning files the record with its own incident, never as a totals mismatch", () => {
  it.each<ValidationCode>([
    "HUELLA_MISMATCH",
    "FECHA_HORA_FUTURE",
    "CLAVE_REGIMEN_REQUIRED",
    "CLAVE_REGIMEN_VALUE",
  ])("%s", async (code) => {
    injected.issues = [warning(code)];
    await append();

    expect(await suite.db.select().from(registrosFacturacion)).toHaveLength(1);
    expect(await incidents()).toEqual([
      {
        code: "fiscal.record_flagged",
        severity: "warning",
        params: { fields: [`field-of-${code}`], codes: [code] },
      },
    ]);
  });

  it("raises each kind once, side by side, when both arrive together", async () => {
    injected.issues = [warning("CUOTA_TOTAL_MISMATCH"), warning("HUELLA_MISMATCH")];
    await append();

    expect(await incidents()).toEqual([
      {
        code: "fiscal.record_flagged",
        severity: "warning",
        params: { fields: ["field-of-HUELLA_MISMATCH"], codes: ["HUELLA_MISMATCH"] },
      },
      {
        code: "fiscal.record_totals_disagree",
        severity: "warning",
        params: { fields: ["field-of-CUOTA_TOTAL_MISMATCH"], codes: ["CUOTA_TOTAL_MISMATCH"] },
      },
    ]);
  });

  it("flags a real one too: an IPSI line with no regime code, which is a warning until 2027", async () => {
    await append((saleId) => {
      const alta = altaFor(till.tillId, saleId, 1, 1);
      const ipsiLine = { ...alta.input.Desglose[0]!, Impuesto: "02" as const };
      delete ipsiLine.ClaveRegimen;
      return { ...alta, input: { ...alta.input, Desglose: [ipsiLine] } };
    });

    expect(await incidents()).toEqual([
      {
        code: "fiscal.record_flagged",
        severity: "warning",
        params: { fields: ["Desglose[0].ClaveRegimen"], codes: ["CLAVE_REGIMEN_REQUIRED"] },
      },
    ]);
  });
});
