// Reads source TEXT, which makes it weaker than its name in these ways:
// - It matches only double-quoted literals with one dot and nothing but lowercase letters and
//   underscores (`/"([a-z_]+\.[a-z_]+)"/`). A single-quoted or backtick code, a code with a digit or a
//   second dot, and a code built at runtime all escape the scan.
// - A code counts as recorded because its text appears in a listed file, not because anything in
//   production raises it. The `clock.` and `fiscal.reconcile_` codes are counted although no
//   production path raises them today.
// - A file that only names a code and hands it to a writer elsewhere (as `packages/fiscal/src/clock.ts`
//   builds the clock warnings `packages/core/src/record-sale.ts` records) is scanned only if listed.
// - The writers check recognises only `recordIncident(`, `recordIncidentOnce(` and `incidents(tx`.
//   A new file that records incidents through a sink under another name, or passes a transaction
//   variable not named `tx`, is not caught, and neither are the codes that file names.
// - The writers check reads only `.ts` files under `packages/*/src` and `apps/*/src`, skipping any
//   `testing` directory, so a writer elsewhere (such as `apps/server/scripts/`) is not seen.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { ALERT_MESSAGES } from "../apps/dashboard/src/i18n/alert-messages.js";

const root = join(import.meta.dirname, "..");

/** Files that name, as a string literal, the code of an incident that gets recorded. */
const INCIDENT_CODE_SOURCES = [
  "packages/core/src/record-correction.ts",
  "packages/core/src/record-sale.ts",
  "packages/core/src/record-substitution.ts",
  "packages/core/src/record-void.ts",
  "packages/fiscal/src/clock.ts",
  "packages/fiscal-verifactu/src/chain.ts",
  "packages/fiscal-verifactu/src/drain.ts",
  "packages/fiscal-verifactu/src/reconcile.ts",
  "packages/payments-stripe/src/device-provider.ts",
  "packages/payments-sumup/src/provider.ts",
  "packages/payments/src/reconcile.ts",
];

/** Dotted literals in those files that are thrown or name a permission, never recorded. */
const NOT_RECORDED = new Set([
  "chain.append_contention",
  "fiscal.record_invalid",
  "sale.already_substituted",
  "sale.already_voided",
  "sale.not_found",
  "sale.rectify",
  "sale.series_not_found",
  "sale.series_retired",
  "sale.series_wrong_node",
  "sale.series_wrong_purpose",
  "sale.total_mismatch",
  "sale.void",
  "sale.voided",
]);

const WRITES_INCIDENT = /\b(?:recordIncident|recordIncidentOnce)\(|\bincidents\(tx\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "testing") return [];
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    return stat.isFile() && name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

function productionSources(): string[] {
  return ["packages", "apps"].flatMap((top) =>
    readdirSync(join(root, top)).flatMap((pkg) => {
      const src = join(root, top, pkg, "src");
      try {
        return statSync(src).isDirectory() ? sourceFiles(src) : [];
      } catch {
        return [];
      }
    }),
  );
}

function recordedCodes(): string[] {
  const found = new Set<string>();
  for (const file of INCIDENT_CODE_SOURCES) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(/"([a-z_]+\.[a-z_]+)"/g))
      found.add(match[1]!);
  }
  return [...found].filter((code) => !NOT_RECORDED.has(code)).sort();
}

describe("incident codes reach the dashboard alerts", () => {
  it("every file that records an incident is a listed code source", () => {
    const writers = productionSources()
      .filter((file) => WRITES_INCIDENT.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .filter((file) => file !== "packages/core/src/incidents.ts");
    expect(writers.filter((file) => !INCIDENT_CODE_SOURCES.includes(file))).toEqual([]);
  });

  it("finds the incident codes known to be recorded", () => {
    // A control against a scan that silently matches nothing.
    expect(recordedCodes()).toEqual(
      expect.arrayContaining([
        "chain.verification_failed",
        "fiscal.registro_rechazado",
        "payment.reconcile_drift",
      ]),
    );
  });

  it("every recorded code is claimed by an area", () => {
    const prefixes = ALL_MODULES.flatMap((module) => module.alerts?.events ?? []).map(
      (claim) => claim.prefix,
    );
    expect(recordedCodes().filter((code) => !prefixes.some((p) => code.startsWith(p)))).toEqual([]);
  });

  it("every recorded code, and alert.source_unavailable, has English and Spanish wording", () => {
    const missing = [...recordedCodes(), "alert.source_unavailable"].filter(
      (code) => !(ALERT_MESSAGES[code]?.en && ALERT_MESSAGES[code]?.es),
    );
    expect(missing).toEqual([]);
  });
});
