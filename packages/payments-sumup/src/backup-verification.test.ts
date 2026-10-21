import { afterEach, expect, it, vi } from "vitest";
import { SUMUP_CARD_PROVIDER } from "./card-provider.js";

afterEach(() => vi.unstubAllGlobals());
const payload = { apiKey: "synthetic", merchantCode: "M1", affiliateAppId: "-", affiliateKey: "-" };
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
it.each(["apiKey", "merchantCode", "affiliateAppId", "affiliateKey"])(
  "refuses a missing or empty %s",
  (field) => {
    const missing = { ...payload };
    delete missing[field as keyof typeof missing];
    expect(verify(missing)).toBe(false);
    expect(verify({ ...payload, [field]: "" })).toBe(false);
  },
);
it.each([
  ["-", "-"],
  ["app", "key"],
  ["-", "key"],
  ["app", "-"],
])("retains the reader's affiliate absence rule for %s/%s", (affiliateAppId, affiliateKey) => {
  expect(verify({ ...payload, affiliateAppId, affiliateKey })).toBe(true);
});
it("refuses an unknown stored payload field", () => {
  expect(verify({ ...payload, unknown: "value" })).toBe(false);
});
