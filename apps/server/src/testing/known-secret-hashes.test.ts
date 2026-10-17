import { verifyPassword, verifyPin } from "@waitron/identity";
import { describe, expect, it } from "vitest";

import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";

describe("fixturePinHash", () => {
  it("returns a hash that verifies for its PIN and not for another", async () => {
    const stored = fixturePinHash("2468");
    expect(await verifyPin("2468", stored)).toBe(true);
    expect(await verifyPin("2469", stored)).toBe(false);
  });

  it("returns the identical string for the same PIN on a later call", () => {
    expect(fixturePinHash("1357")).toBe(fixturePinHash("1357"));
  });

  it("gives two PINs hashes that do not cross-verify", async () => {
    const first = fixturePinHash("1111");
    const second = fixturePinHash("2222");
    expect(first).not.toBe(second);
    expect(await verifyPin("1111", second)).toBe(false);
    expect(await verifyPin("2222", first)).toBe(false);
  });
});

describe("fixturePasswordHash", () => {
  it("returns a hash that verifies for its password and not for another", async () => {
    const stored = fixturePasswordHash("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("correct horsf", stored)).toBe(false);
  });

  it("returns the identical string for the same password on a later call", () => {
    expect(fixturePasswordHash("battery staple")).toBe(fixturePasswordHash("battery staple"));
  });

  it("gives two passwords hashes that do not cross-verify", async () => {
    const first = fixturePasswordHash("first secret");
    const second = fixturePasswordHash("second secret");
    expect(first).not.toBe(second);
    expect(await verifyPassword("first secret", second)).toBe(false);
    expect(await verifyPassword("second secret", first)).toBe(false);
  });
});
