import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import { localS3Fixture } from "./local-s3-fixture.js";
import { runArchiveAbort, runArchiveRoundTrip } from "./s3-archive-scenario.js";

const MiB = 1024 * 1024;
const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/**
 * A local fixture whose byte budget has room for less than `archiveBytes` more, and whose `scratch`
 * does not exist, so a scenario that writes a file before its reservation fails with ENOENT.
 */
async function spentFixture() {
  const parent = await mkdtemp(join(tmpdir(), "waitron-archive-scenario-"));
  folders.push(parent);
  const scratch = join(parent, "missing");
  const send = vi.fn();
  const local = localS3Fixture({
    bucket: {
      endpoint: "http://127.0.0.1:9",
      region: "us-east-1",
      bucket: "waitron-loop",
      prefix: "local-run/archive/",
      accessKeyId: "id",
      secretAccessKey: "secret",
    },
    venueId: "venue-1",
    scratch,
    signal: new AbortController().signal,
    send,
  });
  local.fixture.reserveUpload(AWS_REHEARSAL_LIMITS.uploadedBytes - 16 * MiB, "delete-object");
  return { local, send };
}

describe("the archive scenarios' budget", () => {
  it("the round trip refuses its 32 MiB archive before it writes a file or sends a request", async () => {
    const { local, send } = await spentFixture();
    await expect(runArchiveRoundTrip(local.fixture)).rejects.toThrow(/fixture-limit/);
    expect(local.events).toEqual([
      {
        scenario: "lifecycle",
        phase: "fixture-limit",
        objectRole: "archive",
        bytes: AWS_REHEARSAL_LIMITS.archiveBytes,
        outcome: "refused",
      },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("the abort refuses its 24 MiB archive before it writes a file or sends a request", async () => {
    const { local, send } = await spentFixture();
    await expect(runArchiveAbort(local.fixture)).rejects.toThrow(/fixture-limit/);
    expect(local.events).toEqual([
      {
        scenario: "lifecycle",
        phase: "fixture-limit",
        objectRole: "archive",
        bytes: 24 * MiB,
        outcome: "refused",
      },
    ]);
    expect(send).not.toHaveBeenCalled();
  });
});
