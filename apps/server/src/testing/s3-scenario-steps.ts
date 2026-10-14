import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { nameOf, type CommandObservation } from "@waitron/stream";
import { buildBackupBackend } from "../backup-backends.js";
import type { StorageBackend } from "../storage-backend.js";
import { receiptErrorName } from "./aws-rehearsal-receipt.js";
import { requestRecorder } from "./aws-request-recorder.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";

/** A request event as `requestRecorder` builds it, read back by a scenario. */
export interface RecordedRequest {
  phase?: unknown;
  api?: unknown;
  count?: unknown;
  bytes?: unknown;
  httpStatus?: unknown;
  outcome?: unknown;
}

export const is2xx = (status: unknown): boolean =>
  typeof status === "number" && status >= 200 && status < 300;

/** A request that was answered, with a 2xx status. */
export const answered2xx = ({ outcome, httpStatus }: RecordedRequest): boolean =>
  outcome === "ok" && is2xx(httpStatus);

/**
 * The receipt-recording pieces every S3 scenario shares. `observe` records each request through the
 * fixture and keeps it for `requestsTo`; `react` then sees the raw observation.
 */
export function scenarioSteps(
  fixture: S3ScenarioFixture,
  scenario: string,
  react?: (observation: CommandObservation) => void,
) {
  const requests: RecordedRequest[] = [];
  const observe = requestRecorder(
    scenario,
    (event) => {
      requests.push(event as RecordedRequest);
      fixture.record(event);
    },
    react,
  );
  return {
    observe,
    requests,
    requestsTo(api: string): RecordedRequest[] {
      return requests.filter((event) => event.phase === "request" && event.api === api);
    },
    phase(name: string, fields: object = {}): void {
      fixture.record({ scenario, phase: name, ...fields, outcome: "ok" });
    },
    /**
     * Runs `run`; anything it throws, a failed `expect` included, is recorded as phase `name` failing
     * and thrown on. A step records no "ok" itself; a step whose success belongs in the receipt ends `run` with
     * `phase(name, ...)`.
     */
    async step<T>(name: string, run: () => T | Promise<T>): Promise<T> {
      try {
        return await run();
      } catch (error) {
        fixture.record({
          scenario,
          phase: name,
          outcome: "failed",
          errorName: receiptErrorName(nameOf(error)),
        });
        throw error;
      }
    },
    /** Runs `body` with a new work folder under the fixture's scratch and a backend over its bucket. */
    async withBackend<T>(body: (backend: StorageBackend, work: string) => Promise<T>): Promise<T> {
      const work = await mkdtemp(join(fixture.scratch, `${scenario}-`));
      try {
        const backend = buildBackupBackend(
          { kind: "s3", id: "rehearsal", bucket: fixture.bucket, venueId: fixture.venueId },
          { observe },
        );
        try {
          return await body(backend, work);
        } finally {
          backend.close();
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  };
}
