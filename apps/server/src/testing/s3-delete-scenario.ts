import { expect } from "vitest";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";
import { answered2xx, scenarioSteps } from "./s3-scenario-steps.js";

const SCENARIO = "delete-many";
const OBJECTS = 1005;
const IN_FLIGHT = 8;
const KEY_PREFIX = "delete-";

/** A Vitest time limit for the scenario; nothing inside it enforces this. */
export const DELETE_MANY_SCENARIO_MS = 180_000;

/**
 * Puts 1,005 tiny objects under the fixture's prefix, deletes them through the backend's
 * `deleteMany`, and checks from the recorded requests themselves that two DeleteObjects calls of
 * 1,000 and 5 keys were answered, and that a listing then finds nothing.
 */
export async function runDeleteManyScenario(fixture: S3ScenarioFixture): Promise<void> {
  const keys = Array.from(
    { length: OBJECTS },
    (_, index) => `${KEY_PREFIX}${String(index + 1).padStart(4, "0")}.txt`,
  );
  const encoder = new TextEncoder();
  const bodies = keys.map((key) => encoder.encode(`${SCENARIO} ${key}\n`));
  fixture.reserveObjects(OBJECTS);
  fixture.reserveUpload(
    bodies.reduce((sum, body) => sum + body.byteLength, 0),
    "delete-object",
  );

  const { step, phase, requests, requestsTo, withBackend } = scenarioSteps(fixture, SCENARIO);
  // Aborted on the first failed upload, so no upload loop outlives the scenario.
  const stopUploads = new AbortController();
  const call = { signal: AbortSignal.any([fixture.signal, stopUploads.signal]) };
  await withBackend(async (backend) => {
    await step("put", async () => {
      let next = 0;
      let first: { error: unknown } | undefined;
      await Promise.allSettled(
        Array.from({ length: IN_FLIGHT }, async () => {
          while (next < keys.length && !call.signal.aborted) {
            const index = next;
            next += 1;
            try {
              await backend.put(keys[index]!, bodies[index]!, call);
            } catch (error) {
              first ??= { error };
              stopUploads.abort();
            }
          }
        }),
      );
      if (first !== undefined) throw first.error;
      fixture.signal.throwIfAborted();
    });

    await step("listed-before", async () => {
      const listed = await backend.list(KEY_PREFIX, call);
      const before = listed.map(({ key }) => key).sort();
      expect(before).toEqual(keys);
      phase("listed-before", { count: before.length });
    });

    await step("deleted", async () => {
      await backend.deleteMany(keys, call);
      const deletes = requestsTo("DeleteObjects");
      expect(deletes.map(({ count }) => count)).toEqual([1000, 5]);
      expect(deletes.every(answered2xx)).toBe(true);
      expect(requests.filter(({ phase: name }) => name === "delete-key-errors")).toEqual([]);
      phase("deleted", { count: deletes.reduce((sum, { count }) => sum + (count as number), 0) });
    });

    await step("listed-after", async () => {
      const after = await backend.list(KEY_PREFIX, call);
      expect(after).toEqual([]);
      phase("listed-after", { count: after.length });
    });
  });
}
