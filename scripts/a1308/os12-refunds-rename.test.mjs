import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";

it("renames refund consumers once and leaves the Madrid and generated inputs alone", async () => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "wt-os12-refunds-"));
  const consumer = "apps/server/src/refund-view.ts";
  const preserved = [
    "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts",
    "packages/country-es/test-fixtures/demo.json",
    "packages/db/drizzle/0000_baseline.sql",
  ];
  const before = `import { billPaymentRefunds, tenderRefunds, tenderRefundState } from "@waitron/db";
const refunds = [billPaymentRefunds, tenderRefunds];
const tables = ["bill_payment_refunds", "tender_refunds"];
`;
  const after = `import { refunds as refundTable, refundState } from "@waitron/db";
const refunds = [refundTable, refundTable];
const tables = ["refunds", "refunds"];
`;
  for (const key of Object.keys(process.env))
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  try {
    git("init", "-q");
    for (const file of [consumer, ...preserved]) {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, before);
    }
    symlinkSync(join(root, preserved[0]), join(root, "apps/server/src/madrid-snapshot.ts"));
    git("add", ".");
    process.chdir(root);
    await import("./os12-refunds-rename.mjs");
    expect(git("diff", "--name-only")).toBe(`${consumer}\n`);
    expect(readFileSync(consumer, "utf8")).toBe(after);
    for (const file of preserved) expect(readFileSync(file, "utf8")).toBe(before);

    git("add", ".");
    vi.resetModules();
    await import("./os12-refunds-rename.mjs");
    expect(git("diff", "--name-only")).toBe("");
  } finally {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});
