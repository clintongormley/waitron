import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu/src/slot.js";
import {
  NOW,
  parentFixture,
} from "@waitron/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import {
  diagnosisChildFixture,
  diagnosisSnapshot,
} from "./testing/certificate-diagnosis-snapshot.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let child: Awaited<ReturnType<typeof diagnosisChildFixture>> | undefined;
beforeAll(async () => {
  child = await diagnosisChildFixture();
}, 100_000);
afterAll(async () => {
  await child?.close();
});

it("retains a completed native result while final no-touch authorization queues beyond the default cleanup window", async () => {
  const f = await parentFixture(suite.db);
  const before = await diagnosisSnapshot(suite.db);
  const runner = createCertificateDiagnosisRunner({
    fiscalId: "fixture",
    entry: child!.entry,
    workMs: 15_000,
  });
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let acquired!: () => void;
  const granted = new Promise<void>((done) => {
    acquired = done;
  });
  let turn: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const marker = join(child!.root, "post-child-queue");
  const pending = runner.attempt(
    async (runChild, signal) =>
      FISCAL_SLOT.certificate!.diagnose!(
        {
          ...f.deps,
          signal,
          runChild: async (data, abort) => {
            const result = await runChild(
              { data, marker, endpoint: "https://127.0.0.1:1", ca: "unused for local inspection" },
              abort,
            );
            expect(result.outcome).toBe("completed");
            const pid = Number(await readFile(marker, "utf8"));
            expect(() => process.kill(pid, 0)).toThrowError(
              expect.objectContaining({ code: "ESRCH" }),
            );
            turn = suite.db.withWriteLock(async () => {
              acquired();
              await hold;
            });
            await granted;
            timer = setTimeout(release, 2_500);
            return result;
          },
        },
        f.request,
        NOW,
      ),
    new AbortController().signal,
  );
  try {
    await expect(pending).resolves.toMatchObject({
      category: "local-ready",
      operation: "inspect",
      cause: "not-established",
    });
    expect(await diagnosisSnapshot(suite.db)).toEqual(before);
    await expect(runner.attempt(async () => "next", new AbortController().signal)).resolves.toBe(
      "next",
    );
  } finally {
    release();
    if (timer) clearTimeout(timer);
    await turn;
    await runner.stop();
  }
});
