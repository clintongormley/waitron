import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { KEY_ONLY_CANDIDATE, RC2_CANDIDATE } from "../test/openssl-certificates.js";
import { FISCAL_SLOT } from "./slot.js";

const authority = makeAuthority();
const candidate = authority.issue();
const noKey = authority.issue({ withKey: false });
const expired = authority.issue({ notAfter: new Date("2026-10-16T12:00:00Z") });
const future = authority.issue({ notBefore: new Date("2026-10-16T12:00:01Z") });
const secret = FISCAL_SLOT.provisioningSecret!;
const body = (pfx: Buffer, passphrase = candidate.passphrase) => ({
  pfxBase64: pfx.toString("base64"),
  passphrase,
  certKind: "sello",
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-16T12:00:00Z");
});
afterEach(() => vi.useRealTimers());

describe("setup certificate local validation", () => {
  it.each([
    ["wrong passphrase", body(candidate.pfx, "wrong-passphrase"), "passphrase", "passphrase_wrong"],
    ["non-certificate", body(Buffer.from("not a certificate")), "pfxBase64", "unreadable"],
    ["missing private key", body(noKey.pfx), "pfxBase64", "no_private_key"],
    ["old encryption", RC2_CANDIDATE, "pfxBase64", "old_encryption"],
    ["key without certificate", KEY_ONLY_CANDIDATE, "pfxBase64", "unreadable"],
    ["expired at its exact end", body(expired.pfx), "pfxBase64", "expired"],
    ["not yet valid", body(future.pfx), "pfxBase64", "not_yet_valid"],
    ["oversized file", body(Buffer.alloc(100 * 1024 + 1)), "pfxBase64", "too_large"],
  ])("refuses %s with only the field and reason", (_label, certificate, field, reason) => {
    expect(() => secret.validate({ ...certificate, certKind: "sello" })).toThrowError(
      expect.objectContaining({ code: "setup.certificate_refused", params: { field, reason } }),
    );
  });

  it("accepts an opening certificate at its start and before its end with either kind", () => {
    const starting = authority.issue({ notBefore: new Date("2026-10-16T12:00:00Z") });
    for (const certKind of ["sello", "representante"]) {
      expect(() => secret.validate({ ...body(starting.pfx), certKind })).not.toThrow();
      vi.setSystemTime("2026-10-16T11:59:59.999Z");
      expect(() => secret.validate({ ...body(expired.pfx), certKind })).not.toThrow();
      vi.setSystemTime("2026-10-16T12:00:00Z");
    }
  });
});
