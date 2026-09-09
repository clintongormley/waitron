import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFiscalReadinessStore, type FiscalReadinessInput } from "./fiscal-readiness.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const input: FiscalReadinessInput = {
  requirement: "accepted-test-submission",
  fiscalModule: "verifactu",
  country: "ES",
  taxId: "B12345678",
  legalName: "Ready SL",
  fiscalTerritory: "ES-common",
  certificateFingerprint: "cert-one",
  certificateKind: "sello",
  moduleVersions: { core: 1, "fiscal-verifactu": 2 },
  applicationVersion: "0.0.0",
};

async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-fiscal-readiness-"));
  dirs.push(dir);
  return dir;
}

describe("fiscal activation readiness", () => {
  it("persists accepted server evidence across a restart and binds it to the inputs", async () => {
    const dir = await stateDir();
    const submit = vi.fn().mockResolvedValue("accepted");
    const first = createFiscalReadinessStore(dir, submit);
    await expect(first.run(input)).resolves.toMatchObject({ status: "accepted" });
    expect(submit).toHaveBeenCalledOnce();

    const restarted = createFiscalReadinessStore(dir, vi.fn());
    await expect(restarted.assertReady(input)).resolves.toBeUndefined();
    await expect(restarted.assertReady({ ...input, taxId: "B87654321" })).rejects.toMatchObject({
      code: "setup.fiscal_test_required",
    });
  });

  it.each(["rejected", "uncertain"] as const)(
    "does not manufacture accepted evidence from a %s outcome",
    async (outcome) => {
      const store = createFiscalReadinessStore(
        await stateDir(),
        vi.fn().mockResolvedValue(outcome),
      );
      await expect(store.run(input)).resolves.toMatchObject({ status: outcome });
      await expect(store.assertReady(input)).rejects.toMatchObject({
        code: "setup.fiscal_test_required",
      });
    },
  );

  it("marks a no-filing regime not applicable without invoking a submission", async () => {
    const submit = vi.fn();
    const store = createFiscalReadinessStore(await stateDir(), submit);
    const none = { ...input, requirement: "not-applicable" as const, fiscalModule: "none" };
    await expect(store.run(none)).resolves.toEqual({ status: "not-applicable" });
    await expect(store.assertReady(none)).resolves.toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
  });
});
