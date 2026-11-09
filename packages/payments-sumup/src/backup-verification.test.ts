import { afterEach, expect, it, vi } from "vitest";
import { SUMUP_CARD_PROVIDER } from "./card-provider.js";

afterEach(() => vi.unstubAllGlobals());
const payload = { apiKey: "synthetic", merchantCode: "M1" };
function verify(value: Record<string, string>) {
  expect(SUMUP_CARD_PROVIDER.verifyBackupCredential).toBeTypeOf("function");
  return SUMUP_CARD_PROVIDER.verifyBackupCredential!(value, "preproduction");
}
it("checks captured credentials without contacting the provider", () => {
  const network = vi.fn(() => {
    throw new Error("Network during offline check");
  });
  vi.stubGlobal("fetch", network);
  expect(verify(payload)).toBe(true);
  expect(network).not.toHaveBeenCalled();
});
it.each(["apiKey", "merchantCode"])("refuses a missing or empty %s", (field) => {
  const missing = { ...payload };
  delete missing[field as keyof typeof missing];
  expect(verify(missing)).toBe(false);
  expect(verify({ ...payload, [field]: "" })).toBe(false);
});
it("refuses obsolete venue affiliate fields", () => {
  expect(verify({ ...payload, affiliateAppId: "app", affiliateKey: "key" })).toBe(false);
});
it("refuses an unknown stored payload field", () => {
  expect(verify({ ...payload, unknown: "value" })).toBe(false);
});
