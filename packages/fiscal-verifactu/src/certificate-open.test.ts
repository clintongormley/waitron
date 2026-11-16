import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { openCertificateFile } from "./certificate-file.js";
import { openCertificate } from "./certificate-open.js";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";

const candidate = makeAuthority().issue();

describe("bounded certificate opening", () => {
  it("opens the source entry, preserves details and refuses the wrong passphrase", async () => {
    expect(await openCertificate(candidate.pfx, candidate.passphrase)).toEqual(
      openCertificateFile(candidate.pfx, candidate.passphrase),
    );
    expect(await openCertificate(candidate.pfx, "wrong password")).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
    expect(
      await openCertificate(Buffer.alloc(CERTIFICATE_MAX_BYTES + 1), candidate.passphrase),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("ends hostile-cost opening while other work keeps running", async () => {
    const asn = forge.asn1.fromDer(candidate.pfx.toString("binary"));
    const mac = (asn.value as forge.asn1.Asn1[])[2]!;
    (mac.value as forge.asn1.Asn1[])[2]!.value = "\x7f\xff\xff\xff";
    const hostile = Buffer.from(forge.asn1.toDer(asn).getBytes(), "binary");
    const order: string[] = [];
    const timer = new Promise<void>((resolve) =>
      setTimeout(() => {
        order.push("timer");
        resolve();
      }, 0),
    );
    const opening = openCertificate(hostile, candidate.passphrase).then((result) => {
      order.push("opened");
      return result;
    });
    await timer;
    expect(await opening).toEqual({ ok: false, reason: "unreadable" });
    expect(order).toEqual(["timer", "opened"]);
    expect(await openCertificate(candidate.pfx, candidate.passphrase)).toMatchObject({ ok: true });
  }, 15_000);
});
