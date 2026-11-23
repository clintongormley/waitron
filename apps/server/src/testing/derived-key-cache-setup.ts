import { writeSync } from "node:fs";
import { afterAll, vi } from "vitest";
import type * as Identity from "@waitron/identity";

// Serves a repeated scrypt derivation from memory within one test file. Exact input only: any
// passphrase, salt or cost not seen before is derived for real, and a failure is never stored.
vi.mock("../../../../packages/provisioning/src/scrypt-kdf.ts", async (importOriginal) =>
  (await import("./derived-key-cache.js")).cachedKdf(await importOriginal()),
);

let checked = 0;
let repeated = 0;

vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof Identity>();
  const { isWatchingDerivations } = await import("./watched-scrypt.js");
  const settled = new Set<string>();
  return {
    ...actual,
    async verifySecretAsync(secret: string, stored: string): Promise<boolean> {
      if (
        isWatchingDerivations() ||
        !stored.startsWith("scrypt$") ||
        stored.split("$").length !== 3
      ) {
        return actual.verifySecretAsync(secret, stored);
      }
      const pair = JSON.stringify([secret, stored]);
      const seen = settled.has(pair);
      const result = await actual.verifySecretAsync(secret, stored);
      checked += 1;
      if (seen) repeated += 1;
      settled.add(pair);
      return result;
    },
  };
});

afterAll(() => {
  if (checked > 0) writeSync(2, `[recovery-key-count] checked=${checked} repeated=${repeated}\n`);
});
