import { describe, expect, it } from "vitest";
import { hasCode } from "@waitron/shared";
import { PURPOSES, isPurpose, validatePayload } from "./purposes.js";
import { capturedSync as captured } from "./testing/captured.js";

describe("PURPOSES", () => {
  it("declares the three purposes the host needs", () => {
    expect(Object.keys(PURPOSES).sort()).toEqual([
      "fiscal.aeat",
      "payments.stripe",
      "sync.mirror_token",
    ]);
  });

  it("names every field the Stripe hosted client is constructed from", () => {
    // stripeHostedClient(stripe, { successUrl, cancelUrl, webhookSecret }) plus the secret key the
    // Stripe SDK itself needs. If that constructor grows a field, this list and this test change
    // together.
    expect([...PURPOSES["payments.stripe"]].sort()).toEqual([
      "cancelUrl",
      "secretKey",
      "successUrl",
      "webhookSecret",
    ]);
  });

  it("requires certKind on fiscal.aeat, because the sello endpoint is a different AEAT host", () => {
    // SOAP_ENDPOINTS_SELLO is www10/prewww10, not www1/prewww1. The endpoint is therefore a
    // function of the certificate's kind, which is per-tenant provisioning data — the host cannot
    // infer it without parsing X.509 policy OIDs.
    expect(PURPOSES["fiscal.aeat"]).toEqual(["pfxBase64", "passphrase", "certKind"]);
    expect(() =>
      validatePayload("fiscal.aeat", { pfxBase64: "AAA=", passphrase: "s3cret" }),
    ).toThrow(/credentials.invalid_payload/);
  });
});

describe("sync.mirror_token purpose", () => {
  it("is a known purpose whose payload field is `token`", () => {
    expect(isPurpose("sync.mirror_token")).toBe(true);
    expect(PURPOSES["sync.mirror_token"]).toEqual(["token"]);
  });
  it("validatePayload accepts a token and rejects a payload missing it", () => {
    expect(() => validatePayload("sync.mirror_token", { token: "abc" })).not.toThrow();
    expect(() => validatePayload("sync.mirror_token", {})).toThrow();
  });
});

describe("isPurpose", () => {
  it("accepts a known purpose", () => {
    expect(isPurpose("payments.stripe")).toBe(true);
  });

  it("rejects an unknown one", () => {
    expect(isPurpose("payments.adyen")).toBe(false);
  });

  it("rejects an inherited Object.prototype key, never mistaking it for an own one", () => {
    // Task 5's CLI runs this on raw argv. `value in PURPOSES` would return `true` for `"toString"`
    // (inherited from Object.prototype) even though `PURPOSES` has no own property by that name —
    // `Object.prototype.hasOwnProperty.call` is what tells the two apart, and this is the one test
    // that would notice if a future edit swapped it for the shorter `in` form.
    expect(isPurpose("toString")).toBe(false);
  });
});

describe("validatePayload", () => {
  const ok = {
    secretKey: "sk_test_x",
    webhookSecret: "whsec_x",
    successUrl: "https://example.test/ok",
    cancelUrl: "https://example.test/no",
  };

  it("accepts an exact field match", () => {
    expect(() => validatePayload("payments.stripe", { ...ok })).not.toThrow();
  });

  it("rejects a missing field", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { webhookSecret: _omitted, ...partial } = ok;
    const error = captured(() => validatePayload("payments.stripe", partial));
    expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
  });

  it("rejects an unexpected field, which is how a typo surfaces", () => {
    // A mistyped `webhook_secret` reads as BOTH a missing `webhookSecret` and an unexpected
    // `webhook_secret`. Accepting extras would report only the former and leave the operator
    // hunting a value they believe they set.
    const error = captured(() =>
      validatePayload("payments.stripe", { ...ok, webhook_secret: "whsec_x" }),
    );
    expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
  });

  it("rejects an empty value", () => {
    const error = captured(() => validatePayload("payments.stripe", { ...ok, secretKey: "" }));
    expect(hasCode(error, "credentials.invalid_field")).toBe(true);
  });

  it("rejects a non-string value", () => {
    const error = captured(() => validatePayload("payments.stripe", { ...ok, secretKey: 42 }));
    expect(hasCode(error, "credentials.invalid_field")).toBe(true);
  });

  it("names no VALUE in the error it raises", () => {
    // The whole point: a validation failure must be diagnosable without ever printing a secret.
    const error = captured(() =>
      validatePayload("payments.stripe", { ...ok, extra: "sk_live_OOPS" }),
    );
    expect(JSON.stringify(error)).not.toContain("sk_live_OOPS");
  });

  it("never echoes an unexpected field's own NAME either — only a count (M7)", () => {
    // Distinct from the value-leak test above: here the SENSITIVE text is the extra field's own
    // key, not its value — the shape an operator produces by piping a raw secret in as a bare JSON
    // object key by mistake. Before this fix, `unexpected` carried the actual supplied field names
    // verbatim, so this exact string would have appeared in the thrown AppError's params.
    const error = captured(() =>
      validatePayload("payments.stripe", { ...ok, sk_live_51LEAKED: "x" }),
    );
    expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
    expect(JSON.stringify(error.params)).not.toContain("sk_live_51LEAKED");
    expect(error.params).toMatchObject({ unexpectedCount: 1 });
  });
});
