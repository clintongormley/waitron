import { expect } from "vitest";
import { buildBackupBackend } from "../backup-backends.js";
import { requestRecorder } from "./aws-request-recorder.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";

const SCENARIO = "delete-many";
const OBJECTS = 1005;
const IN_FLIGHT = 8;
const KEY_PREFIX = "delete-";

/** A Vitest time limit for the scenario; nothing inside it enforces this. */
export const DELETE_MANY_SCENARIO_MS = 180_000;

export interface DeleteManySummary {
  put: number;
  /** The key count of each DeleteObjects request, in the order they were sent. */
  deleteBatches: number[];
  remaining: number;
}

type Recorded = {
  phase?: unknown;
  api?: unknown;
  count?: unknown;
  httpStatus?: unknown;
  outcome?: unknown;
};

/**
 * Puts 1,005 tiny objects under the fixture's prefix, deletes them through the backend's
 * `deleteMany`, and checks from the recorded requests themselves that two DeleteObjects calls of
 * 1,000 and 5 keys were answered, and that a listing then finds nothing.
 */
export async function runDeleteManyScenario(
  fixture: S3ScenarioFixture,
): Promise<DeleteManySummary> {
  const keys = Array.from(
    { length: OBJECTS },
    (_, index) => `${KEY_PREFIX}${String(index + 1).padStart(4, "0")}.txt`,
  );
  const bodies = keys.map((key) => new TextEncoder().encode(`${SCENARIO} ${key}\n`));
  fixture.reserveObjects(OBJECTS);
  fixture.reserveUpload(
    bodies.reduce((sum, body) => sum + body.byteLength, 0),
    "delete-object",
  );

  const requests: Recorded[] = [];
  const backend = buildBackupBackend(
    { kind: "s3", id: "rehearsal", bucket: fixture.bucket, venueId: fixture.venueId },
    {
      observe: requestRecorder(SCENARIO, (event) => {
        requests.push(event as Recorded);
        fixture.record(event);
      }),
    },
  );
  const call = { signal: fixture.signal };
  const phase = (name: string, count: number, ok: boolean): void => {
    fixture.record({ scenario: SCENARIO, phase: name, count, outcome: ok ? "ok" : "failed" });
  };
  try {
    let next = 0;
    await Promise.all(
      Array.from({ length: IN_FLIGHT }, async () => {
        while (next < keys.length) {
          const index = next;
          next += 1;
          await backend.put(keys[index]!, bodies[index]!, call);
        }
      }),
    );

    const before = (await backend.list(KEY_PREFIX, call)).map(({ key }) => key).sort();
    phase("listed-before", before.length, before.join("\n") === keys.join("\n"));
    expect(before).toEqual(keys);

    await backend.deleteMany(keys, call);
    const deletes = requests.filter(
      ({ phase: name, api }) => name === "request" && api === "DeleteObjects",
    );
    const deleteBatches = deletes.map(({ count }) => count as number);
    const keyErrors = requests.filter(({ phase: name }) => name === "delete-key-errors");
    const answered = deletes.every(
      ({ outcome, httpStatus }) =>
        outcome === "ok" && typeof httpStatus === "number" && httpStatus >= 200 && httpStatus < 300,
    );
    const batchesOk = answered && keyErrors.length === 0 && deleteBatches.join(",") === "1000,5";
    phase(
      "deleted",
      deleteBatches.reduce((sum, count) => sum + count, 0),
      batchesOk,
    );
    expect(deletes.map(({ count, outcome }) => ({ count, outcome }))).toEqual([
      { count: 1000, outcome: "ok" },
      { count: 5, outcome: "ok" },
    ]);
    expect(answered).toBe(true);
    expect(keyErrors).toEqual([]);

    const after = await backend.list(KEY_PREFIX, call);
    phase("listed-after", after.length, after.length === 0);
    expect(after).toEqual([]);
    return { put: keys.length, deleteBatches, remaining: after.length };
  } finally {
    backend.close();
  }
}
