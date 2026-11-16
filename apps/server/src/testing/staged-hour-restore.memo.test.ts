import "./staged-hour-restore.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashSecret, verifySecretAsync } from "@waitron/identity";
import {
  failingDerivationsOf,
  watchDerivations,
  watchedDerivationCount,
  watchedOrder,
} from "./watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

afterEach(async () => {
  await watchedOrder();
});

describe("the staged-restore fixture's secret-check memo", () => {
  it("derives a repeated or concurrent exact pair once", async () => {
    const secret = "repeated recovery key";
    const stored = hashSecret(secret);
    watchDerivations(secret);
    expect(
      await Promise.all([
        verifySecretAsync(secret, stored),
        verifySecretAsync(secret, stored),
        verifySecretAsync(secret, stored),
      ]),
    ).toEqual([true, true, true]);
    expect(await verifySecretAsync(secret, stored)).toBe(true);
    expect(watchedDerivationCount()).toBe(1);
  });

  it("keeps different secrets and stored hashes separate, including refusals", async () => {
    const secret = "current recovery key";
    const stored = hashSecret(secret);
    const other = hashSecret("replacement recovery key");
    watchDerivations(secret);
    expect(await verifySecretAsync(secret, stored)).toBe(true);
    expect(await verifySecretAsync("wrong recovery key", stored)).toBe(false);
    expect(await verifySecretAsync(secret, other)).toBe(false);
    expect(await verifySecretAsync("replacement recovery key", other)).toBe(true);
    expect(await verifySecretAsync(secret, other)).toBe(false);
    expect(watchedDerivationCount()).toBe(2);
  });

  it("retries a pair after its real derivation rejects", async () => {
    const secret = "retry recovery key";
    const stored = hashSecret(secret);
    await expect(
      failingDerivationsOf(secret, () => verifySecretAsync(secret, stored)),
    ).rejects.toThrow("scrypt failed (test fault)");
    expect(await verifySecretAsync(secret, stored)).toBe(true);
  });

  it("gives the event loop a turn before returning a remembered answer", async () => {
    const secret = "yielding recovery key";
    const stored = hashSecret(secret);
    expect(await verifySecretAsync(secret, stored)).toBe(true);
    const order: string[] = [];
    const turned = new Promise<void>((resolve) => {
      setImmediate(() => {
        order.push("event loop");
        resolve();
      });
    });
    expect(await verifySecretAsync(secret, stored)).toBe(true);
    order.push("verified");
    await turned;
    expect(order).toEqual(["event loop", "verified"]);
  });
});
