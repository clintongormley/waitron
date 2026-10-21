import { vi } from "vitest";

// Serves a repeated scrypt derivation from memory within one test file. Exact input only: any
// passphrase, salt or cost not seen before is derived for real, and a failure is never stored.
vi.mock("../../../../packages/provisioning/src/scrypt-kdf.ts", async (importOriginal) =>
  (await import("./derived-key-cache.js")).cachedKdf(await importOriginal()),
);
