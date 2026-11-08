import { describe, expect, it } from "vitest";
import { createVerifiedTokenMemory } from "./verified-tokens.js";

const HASH = "scrypt$salt$key";

describe("createVerifiedTokenMemory", () => {
  it("answers false for an id it has never been told about", () => {
    expect(createVerifiedTokenMemory(2).alreadyVerified("a", "token", HASH)).toBe(false);
  });

  it("answers true for the remembered token against the hash it passed with", () => {
    const memory = createVerifiedTokenMemory(2);
    memory.remember("a", "token", HASH);
    expect(memory.alreadyVerified("a", "token", HASH)).toBe(true);
  });

  it("answers false, without throwing, for a different token of the same or another length", () => {
    const memory = createVerifiedTokenMemory(2);
    memory.remember("a", "token", HASH);
    expect(memory.alreadyVerified("a", "tokeX", HASH)).toBe(false);
    expect(memory.alreadyVerified("a", "a much longer token than the first", HASH)).toBe(false);
    expect(memory.alreadyVerified("a", "", HASH)).toBe(false);
    expect(memory.alreadyVerified("a", "token", HASH)).toBe(true);
  });

  it("drops the entry when the stored hash has changed, so the old hash does not match again", () => {
    const memory = createVerifiedTokenMemory(2);
    memory.remember("a", "token", HASH);
    expect(memory.alreadyVerified("a", "token", "scrypt$other$hash")).toBe(false);
    expect(memory.alreadyVerified("a", "token", HASH)).toBe(false);
  });

  it("removes the oldest entry when a new id arrives at the limit", () => {
    const memory = createVerifiedTokenMemory(2);
    memory.remember("a", "token-a", HASH);
    memory.remember("b", "token-b", HASH);
    memory.remember("c", "token-c", HASH);
    expect(memory.alreadyVerified("a", "token-a", HASH)).toBe(false);
    expect(memory.alreadyVerified("b", "token-b", HASH)).toBe(true);
    expect(memory.alreadyVerified("c", "token-c", HASH)).toBe(true);
  });

  it("counts the oldest entry as newest when it is remembered again at the limit", () => {
    const memory = createVerifiedTokenMemory(2);
    memory.remember("a", "token-a", HASH);
    memory.remember("b", "token-b", HASH);
    memory.remember("a", "token-a", HASH);
    expect(memory.alreadyVerified("a", "token-a", HASH)).toBe(true);
    expect(memory.alreadyVerified("b", "token-b", HASH)).toBe(true);

    memory.remember("c", "token-c", HASH);
    expect(memory.alreadyVerified("b", "token-b", HASH)).toBe(false);
    expect(memory.alreadyVerified("a", "token-a", HASH)).toBe(true);
  });

  it("evicts nothing when the newest entry is remembered again at the limit", () => {
    const memory = createVerifiedTokenMemory(2);
    memory.remember("a", "token-a", HASH);
    memory.remember("b", "token-b", HASH);
    memory.remember("b", "token-b", HASH);
    expect(memory.alreadyVerified("a", "token-a", HASH)).toBe(true);
    expect(memory.alreadyVerified("b", "token-b", HASH)).toBe(true);
  });

  it("keeps every entry when one is remembered again below the limit, and counts it as newest", () => {
    const memory = createVerifiedTokenMemory(3);
    memory.remember("a", "token-a", HASH);
    memory.remember("b", "token-b", HASH);
    memory.remember("a", "token-a", HASH);
    memory.remember("c", "token-c", HASH);
    expect(memory.alreadyVerified("a", "token-a", HASH)).toBe(true);
    expect(memory.alreadyVerified("b", "token-b", HASH)).toBe(true);
    expect(memory.alreadyVerified("c", "token-c", HASH)).toBe(true);

    memory.remember("d", "token-d", HASH);
    expect(memory.alreadyVerified("b", "token-b", HASH)).toBe(false);
    expect(memory.alreadyVerified("a", "token-a", HASH)).toBe(true);
    expect(memory.alreadyVerified("c", "token-c", HASH)).toBe(true);
    expect(memory.alreadyVerified("d", "token-d", HASH)).toBe(true);
  });

  it("forgets one id and leaves the others", () => {
    const memory = createVerifiedTokenMemory(2);
    memory.remember("a", "token-a", HASH);
    memory.remember("b", "token-b", HASH);
    memory.forget("a");
    expect(memory.alreadyVerified("a", "token-a", HASH)).toBe(false);
    expect(memory.alreadyVerified("b", "token-b", HASH)).toBe(true);
  });

  it("keeps two memories apart", () => {
    const one = createVerifiedTokenMemory(2);
    const other = createVerifiedTokenMemory(2);
    one.remember("a", "token", HASH);
    expect(other.alreadyVerified("a", "token", HASH)).toBe(false);
  });
});
