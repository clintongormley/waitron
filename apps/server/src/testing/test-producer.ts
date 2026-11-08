import { afterAll, beforeAll } from "vitest";

export const TEST_PRODUCER = {
  WAITRON_PRODUCER_NAME: "PRODUCER PERSON",
  WAITRON_PRODUCER_TAX_ID: "00000000T",
  WAITRON_PRODUCER_ADDRESS: "1 Example Street, 00000 Nowhere (Province), Spain",
} as const;

/**
 * Names a made-up producer for the whole file, so a production start in it does not refuse.
 * Written to `process.env` directly rather than through `vi.stubEnv`: some files that use it call
 * `vi.unstubAllEnvs()`, which would drop a stubbed producer mid-file.
 */
export function useTestProducer(): void {
  const before = new Map<string, string | undefined>();
  beforeAll(() => {
    for (const [name, value] of Object.entries(TEST_PRODUCER)) {
      before.set(name, process.env[name]);
      process.env[name] = value;
    }
  });
  afterAll(() => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}
