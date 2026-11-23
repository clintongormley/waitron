import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret, verifySecretAsync } from "@waitron/identity";

const derivations = vi.hoisted(() => ({ count: 0, failNext: false }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const scrypt = (
    secret: string,
    salt: Buffer,
    keyLength: number,
    done: (error: Error | null, key: Buffer) => void,
  ) => {
    derivations.count += 1;
    if (derivations.failNext) {
      derivations.failNext = false;
      throw new Error("scrypt failed (test fault)");
    }
    actual.scrypt(secret, salt, keyLength, done);
  };
  return { ...actual, scrypt };
});

beforeEach(() => {
  derivations.count = 0;
  derivations.failNext = false;
});

describe("the server test setup's secret-check memo", () => {
  it("derives a repeated or concurrent exact pair once", async () => {
    const secret = "repeated recovery key";
    const stored = hashSecret(secret);
    expect(
      await Promise.all([
        verifySecretAsync(secret, stored),
        verifySecretAsync(secret, stored),
        verifySecretAsync(secret, stored),
      ]),
    ).toEqual([true, true, true]);
    expect(await verifySecretAsync(secret, stored)).toBe(true);
    expect(derivations.count).toBe(1);
  });

  it("keeps different secrets and stored hashes separate, including refusals", async () => {
    const secret = "current recovery key";
    const stored = hashSecret(secret);
    const other = hashSecret("replacement recovery key");
    const sameSecret = hashSecret(secret);
    expect(await verifySecretAsync(secret, stored)).toBe(true);
    expect(await verifySecretAsync("wrong recovery key", stored)).toBe(false);
    expect(await verifySecretAsync("wrong recovery key", stored)).toBe(false);
    expect(derivations.count).toBe(2);
    expect(await verifySecretAsync(secret, sameSecret)).toBe(true);
    expect(derivations.count).toBe(3);
    expect(await verifySecretAsync(secret, other)).toBe(false);
    expect(await verifySecretAsync("replacement recovery key", other)).toBe(true);
    expect(await verifySecretAsync(secret, other)).toBe(false);
    expect(derivations.count).toBe(5);
  });

  it("retries a pair after its real derivation rejects", async () => {
    const secret = "retry recovery key";
    const stored = hashSecret(secret);
    derivations.failNext = true;
    await expect(verifySecretAsync(secret, stored)).rejects.toThrow("scrypt failed (test fault)");
    expect(await verifySecretAsync(secret, stored)).toBe(true);
    expect(derivations.count).toBe(2);
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
