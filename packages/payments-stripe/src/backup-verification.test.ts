import { afterEach, expect, it, vi } from "vitest";
import { createStripeCardProvider } from "./card-provider.js";

afterEach(() => vi.unstubAllGlobals());
const payload = {
  secretKey: "sk_test_synthetic",
  webhookSecret: "whsec_synthetic",
  successUrl: "https://example.test/success?session={CHECKOUT_SESSION_ID}",
  cancelUrl: "http://localhost:3000/cancel",
};
function verifier() {
  const forbidden = vi.fn(() => {
    throw new Error("Provider construction during offline check");
  });
  vi.stubGlobal("fetch", forbidden);
  const provider = createStripeCardProvider(forbidden);
  expect(provider.verifyBackupCredential).toBeTypeOf("function");
  return { provider, forbidden };
}
it("checks a captured payload without constructing a client or using the network", () => {
  const { provider, forbidden } = verifier();
  expect(provider.verifyBackupCredential!(payload, "preproduction")).toBe(true);
  expect(forbidden).not.toHaveBeenCalled();
});
it.each(["secretKey", "webhookSecret", "successUrl", "cancelUrl"])(
  "refuses a missing or empty %s",
  (field) => {
    const { provider } = verifier();
    const missing = { ...payload };
    delete missing[field as keyof typeof missing];
    expect(provider.verifyBackupCredential!(missing, "preproduction")).toBe(false);
    expect(provider.verifyBackupCredential!({ ...payload, [field]: "" }, "preproduction")).toBe(
      false,
    );
  },
);
it.each(["successUrl", "cancelUrl"])("parses the captured %s without requesting it", (field) => {
  const { provider, forbidden } = verifier();
  for (const url of ["not a URL", "javascript:alert(1)", "ftp://example.test/archive"])
    expect(provider.verifyBackupCredential!({ ...payload, [field]: url }, "preproduction")).toBe(
      false,
    );
  expect(forbidden).not.toHaveBeenCalled();
});
it.each([
  ["sk_live_synthetic", "production", true],
  ["sk_live_synthetic", "preproduction", false],
  ["sk_test_synthetic", "production", false],
  ["sk_test_synthetic", "preproduction", true],
  ["rk_synthetic", "production", true],
] as const)("checks %s against %s with result %s", (secretKey, environment, expected) => {
  expect(verifier().provider.verifyBackupCredential!({ ...payload, secretKey }, environment)).toBe(
    expected,
  );
});
it("refuses an unknown stored payload field", () => {
  expect(
    verifier().provider.verifyBackupCredential!({ ...payload, unknown: "value" }, "preproduction"),
  ).toBe(false);
});
