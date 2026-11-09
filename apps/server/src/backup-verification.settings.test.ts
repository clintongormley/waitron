import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { verifyBackupArtifact } from "./backup-verification-entry.js";
import * as placement from "./backup-data-placement.js";
import {
  logicalDatabase,
  useBackupVerificationFixture,
  verificationTime,
  type BackupVerificationFixture,
} from "./testing/backup-verification-fixture.js";

const suite = useBackupVerificationFixture();
afterEach(() => vi.restoreAllMocks());
async function verify(f: BackupVerificationFixture) {
  const original = await readFile(f.deps.artifactPath);
  const answer = await verifyBackupArtifact(f.request, f.deps);
  expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
  expect(await readFile(f.deps.artifactPath)).toEqual(original);
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  expect(answer.activation).toBe("not_attempted");
  return answer;
}
it("refuses a restored settings row that differs from the backup's", async () => {
  const f = await suite.create();
  await f.corrupt((db) =>
    db
      .prepare("insert into settings values ('adjustments', 1, 1, ?, ?, null)")
      .run('{"maxBillComp":4000,"billApproverRoles":["manager"]}', verificationTime),
  );
  expect((await verify(f)).status).toBe("passed");
  const place = placement.placeBackupData;
  vi.spyOn(placement, "placeBackupData").mockImplementation(async (...args) => {
    await place(...args);
    const db = new DatabaseSync(join(args[1].venueDir, "venue.db"));
    try {
      db.prepare("update settings set doc = ? where module = 'adjustments'").run(
        '{"maxBillComp":500,"billApproverRoles":["manager"]}',
      );
    } finally {
      db.close();
    }
  });
  const answer = await verify(f);
  expect(answer.status).toBe("invalid");
  expect(answer.modules.find((m) => m.name === "core")?.status).toBe("invalid");
});
