import { describe, expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { MAC_ACCENTED_CANDIDATE, RC2_SIGNED_CANDIDATE } from "../test/openssl-certificates.js";
import { answerOpener } from "./certificate-open-answer.js";

const converter = vi.hoisted(() => ({ loads: 0 }));
vi.mock("./certificate-convert.js", () => {
  converter.loads += 1;
  return { rewriteOldCertificate: () => null };
});

const ask = async (pfx: Buffer, passphrase: string) =>
  JSON.parse(
    await answerOpener(
      JSON.stringify({ pfx: pfx.toString("base64"), passphrase, rewriteOld: true }),
    ),
  ) as Record<string, unknown>;

describe("loading the converter, which loads node-forge", () => {
  it("does not load it for a file Node opens or a wrong passphrase in plain ASCII", async () => {
    const candidate = makeAuthority().issue();
    expect(await ask(candidate.pfx, candidate.passphrase)).toMatchObject({ ok: true });
    expect(await ask(candidate.pfx, "wrong passphrase")).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
    expect(converter.loads).toBe(0);
  });

  it("loads it once Node refuses a file it may rewrite", async () => {
    const rc2 = Buffer.from(RC2_SIGNED_CANDIDATE.pfxBase64, "base64");
    expect(await ask(rc2, RC2_SIGNED_CANDIDATE.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
    expect(converter.loads).toBe(1);
    const mac = Buffer.from(MAC_ACCENTED_CANDIDATE.pfxBase64, "base64");
    expect(await ask(mac, MAC_ACCENTED_CANDIDATE.passphrase)).toEqual({
      ok: false,
      reason: "passphrase_wrong",
    });
  });
});
