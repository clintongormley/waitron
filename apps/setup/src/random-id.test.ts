import { afterEach, expect, it, vi } from "vitest";
import { makeSetupId } from "./random-id.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses the native cryptographic UUID when available", () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("01234567-89ab-4cde-8fab-0123456789ab");
  expect(makeSetupId()).toBe("01234567-89ab-4cde-8fab-0123456789ab");
});

it.each([0, 255])("makes a canonical v4 UUID from cryptographic bytes on HTTP (%i)", (byte) => {
  vi.stubGlobal("crypto", { getRandomValues: (array: Uint8Array) => array.fill(byte) });
  vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Use cryptographic bytes");
  });
  expect(makeSetupId()).toBe(
    byte === 0 ? "00000000-0000-4000-8000-000000000000" : "ffffffff-ffff-4fff-bfff-ffffffffffff",
  );
});
