import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import {
  KEY_ONLY_CANDIDATE,
  MAC_ACCENTED_CANDIDATE,
  RC2_SIGNED_CANDIDATE,
  RC4_CANDIDATE,
} from "../test/openssl-certificates.js";
import { openCertificateFile } from "./certificate-file.js";
import { FISCAL_SLOT } from "./slot.js";

const authority = makeAuthority();
const candidate = authority.issue();
const noKey = authority.issue({ withKey: false });
const expired = authority.issue({ notAfter: new Date("2026-10-16T12:00:00Z") });
const future = authority.issue({ notBefore: new Date("2026-10-16T12:00:01Z") });
const secret = FISCAL_SLOT.provisioningSecret!;
const venue = { taxId: "89890001K" };
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
    ["encryption nothing can read", RC4_CANDIDATE, "pfxBase64", "old_encryption"],
    ["key without certificate", KEY_ONLY_CANDIDATE, "pfxBase64", "unreadable"],
    ["expired at its exact end", body(expired.pfx), "pfxBase64", "expired"],
    ["not yet valid", body(future.pfx), "pfxBase64", "not_yet_valid"],
  ])("refuses %s with only the field and reason", async (_label, certificate, field, reason) => {
    await expect(
      secret.validate({ ...certificate, certKind: "sello" }, venue),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "setup.certificate_refused", params: { field, reason } }),
    );
  });

  it("accepts an opening certificate at its start and before its end with either kind", async () => {
    const starting = authority.issue({ notBefore: new Date("2026-10-16T12:00:00Z") });
    for (const certKind of ["sello", "representante"]) {
      await expect(
        secret.validate({ ...body(starting.pfx), certKind }, venue),
      ).resolves.toBeUndefined();
      vi.setSystemTime("2026-10-16T11:59:59.999Z");
      await expect(
        secret.validate({ ...body(expired.pfx), certKind }, venue),
      ).resolves.toBeUndefined();
      vi.setSystemTime("2026-10-16T12:00:00Z");
    }
  });

  it("refuses a certificate for another tax number, naming both numbers", async () => {
    await expect(secret.validate(body(candidate.pfx), { taxId: "B12345674" })).rejects.toThrowError(
      expect.objectContaining({
        code: "setup.certificate_refused",
        params: {
          field: "pfxBase64",
          reason: "other_taxpayer",
          certificateTaxId: "89890001K",
          taxId: "B12345674",
        },
      }),
    );
  });

  it("accepts the venue's number typed in lower case with spaces and hyphens", async () => {
    await expect(
      secret.validate(body(candidate.pfx), { taxId: " 8989-0001 k" }),
    ).resolves.toBeUndefined();
  });

  it("accepts a certificate that carries no organisation identifier", async () => {
    const personal = authority.issue({ organizationIdentifier: null });
    await expect(
      secret.validate(body(personal.pfx), { taxId: "B12345674" }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["exported with 40-bit RC2", RC2_SIGNED_CANDIDATE],
    ["exported by macOS under an accented passphrase", MAC_ACCENTED_CANDIDATE],
  ])("accepts a file %s that plain Node refuses", async (_label, certificate) => {
    const raw = { ...certificate, certKind: "representante" };
    expect(openCertificateFile(Buffer.from(raw.pfxBase64, "base64"), raw.passphrase)).toMatchObject(
      { ok: false },
    );
    await expect(secret.validate(raw, venue)).resolves.toBeUndefined();
  });
});

it("maps an unavailable setup check to the whole request", async () => {
  const node = process.execPath;
  try {
    process.execPath = "/nonexistent/waitron-node";
    await expect(secret.validate(body(candidate.pfx), venue)).rejects.toMatchObject({
      code: "setup.certificate_refused",
      params: { field: "body", reason: "unavailable" },
    });
  } finally {
    process.execPath = node;
  }
});

describe("setup certificate identity inspection", () => {
  it("returns only the subject's organisation name and tax number", async () => {
    const certificate = authority.issue({
      organisation: "Certificate Company",
      organizationIdentifier: "VATES-B12345674",
    });
    await expect(secret.inspect!(body(certificate.pfx))).resolves.toEqual({
      taxId: "B12345674",
      legalName: "Certificate Company",
    });
  });

  it("leaves missing organisation fields blank even when the subject names a person", async () => {
    const personal = authority.issue({ organisation: null, organizationIdentifier: null });
    await expect(secret.inspect!(body(personal.pfx))).resolves.toEqual({
      taxId: null,
      legalName: null,
    });
  });

  it.each([
    ["expired", expired],
    ["not_yet_valid", future],
  ])("refuses a certificate that is %s using the same setup error", async (reason, certificate) => {
    await expect(secret.inspect!(body(certificate.pfx))).rejects.toMatchObject({
      code: "setup.certificate_refused",
      params: { field: "pfxBase64", reason },
    });
  });
});
