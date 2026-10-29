import { expect, expectTypeOf, it } from "vitest";
import type {
  FiscalCertificateDiagnosisChildResult,
  FiscalCertificateDiagnosisDeps,
  FiscalCertificateJson,
  FiscalCertificateSeat,
} from "./index.js";

it("keeps diagnosis optional for a read/install certificate contribution", async () => {
  const legacy: FiscalCertificateSeat = {
    read: async () => ({ state: "saved" }),
    install: async () => ({ outcome: "installed", reason: "installed" }),
    alerts: async () => [],
    reminders: { claim: async () => null, report: async () => {} },
  };
  expect(legacy.diagnose).toBeUndefined();
  expect(legacy.diagnoseInChild).toBeUndefined();
  expectTypeOf(legacy.read).toBeFunction();
  expectTypeOf(legacy.install).toBeFunction();
});

it("types completed and interrupted child results as ordinary JSON", () => {
  const values: FiscalCertificateDiagnosisChildResult[] = [
    { outcome: "completed", value: { ready: true, nested: [null, "ok", 2] } },
    { outcome: "interrupted", reason: "deadline", lastProgress: { phase: "opening" } },
    { outcome: "interrupted", reason: "cancelled", lastProgress: null },
    { outcome: "interrupted", reason: "unavailable", lastProgress: null },
  ];
  expect(JSON.parse(JSON.stringify(values))).toEqual([
    { outcome: "completed", value: { ready: true, nested: [null, "ok", 2] } },
    { outcome: "interrupted", reason: "deadline", lastProgress: { phase: "opening" } },
    { outcome: "interrupted", reason: "cancelled", lastProgress: null },
    { outcome: "interrupted", reason: "unavailable", lastProgress: null },
  ]);
  expectTypeOf<
    FiscalCertificateDiagnosisDeps["runChild"]
  >().returns.resolves.toEqualTypeOf<FiscalCertificateDiagnosisChildResult>();
  expectTypeOf<
    NonNullable<FiscalCertificateSeat["diagnose"]>
  >().returns.resolves.toEqualTypeOf<FiscalCertificateJson>();
  expectTypeOf<
    NonNullable<FiscalCertificateSeat["diagnoseInChild"]>
  >().returns.resolves.toEqualTypeOf<FiscalCertificateJson>();
  expectTypeOf<Date>().not.toExtend<FiscalCertificateJson>();
  expectTypeOf<Uint8Array>().not.toExtend<FiscalCertificateJson>();
  expectTypeOf<undefined>().not.toExtend<FiscalCertificateJson>();
  expectTypeOf<() => void>().not.toExtend<FiscalCertificateJson>();
});
