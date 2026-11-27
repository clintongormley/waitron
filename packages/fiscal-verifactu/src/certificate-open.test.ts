import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import forge from "node-forge";
import { describe, expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import {
  MAC_ACCENTED_CANDIDATE,
  OPENSSL_AUTHORITY,
  OPENSSL_SIGNED_FINGERPRINT,
  RC2_SIGNED_CANDIDATE,
  RC4_CANDIDATE,
} from "../test/openssl-certificates.js";
import { openCertificateFile } from "./certificate-file.js";
import { openCertificate } from "./certificate-open.js";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";

vi.mock("node:child_process", { spy: true });

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
    expect(await openCertificate(candidate.pfx, "x".repeat(256 * 1024))).toEqual({
      ok: false,
      reason: "unreadable",
    });
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
    expect(await opening).toEqual({ ok: false, reason: "unavailable" });
    expect(order).toEqual(["timer", "opened"]);
    expect(await openCertificate(candidate.pfx, candidate.passphrase)).toMatchObject({ ok: true });
  }, 15_000);
});

describe("rewriting old encryption in the opener", () => {
  const rc2 = Buffer.from(RC2_SIGNED_CANDIDATE.pfxBase64, "base64");

  it("returns a rewritten file Node opens, only when asked", async () => {
    const opened = await openCertificate(rc2, RC2_SIGNED_CANDIDATE.passphrase, {
      rewriteOld: true,
    });
    if (!opened.ok || !("rewritten" in opened) || opened.rewritten === undefined) {
      throw new Error(`not rewritten: ${JSON.stringify(opened)}`);
    }
    expect(opened.details.fingerprint).toBe(OPENSSL_SIGNED_FINGERPRINT);
    expect(opened.details.validFrom).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(openCertificateFile(opened.rewritten, RC2_SIGNED_CANDIDATE.passphrase)).toEqual({
      ok: true,
      details: opened.details,
    });
    expect(await openCertificate(rc2, RC2_SIGNED_CANDIDATE.passphrase)).toEqual({
      ok: false,
      reason: "old_encryption",
    });
  });

  it("returns a rewritten file whose base64 is larger than 8 KiB", async () => {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(rc2.toString("binary")),
      RC2_SIGNED_CANDIDATE.passphrase,
    );
    const shrouded = forge.pki.oids.pkcs8ShroudedKeyBag!;
    const key = p12.getBags({ bagType: shrouded })[shrouded]![0]!.key!;
    const [leaf] = p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!]!;
    const extra = Array<forge.pki.Certificate>(5).fill(
      forge.pki.certificateFromPem(OPENSSL_AUTHORITY.caPem),
    );
    const { passphrase } = MAC_ACCENTED_CANDIDATE;
    // As macOS writes it: the passphrase's UTF-8 bytes taken one character each.
    const macSpelling = Buffer.from(passphrase, "utf8").toString("latin1");
    const file = Buffer.from(
      forge.asn1
        .toDer(
          forge.pkcs12.toPkcs12Asn1(key, [leaf!.cert!, ...extra], macSpelling, {
            algorithm: "3des",
          }),
        )
        .getBytes(),
      "binary",
    );
    const opened = await openCertificate(file, passphrase, { rewriteOld: true });
    if (!opened.ok || !("rewritten" in opened) || opened.rewritten === undefined) {
      throw new Error(`not rewritten: ${JSON.stringify(opened)}`);
    }
    expect(opened.rewritten.toString("base64").length).toBeGreaterThan(8192);
    expect(opened.rewritten.length).toBeLessThanOrEqual(CERTIFICATE_MAX_BYTES);
    expect(opened.details.fingerprint).toBe(OPENSSL_SIGNED_FINGERPRINT);
    expect(openCertificateFile(opened.rewritten, passphrase)).toEqual({
      ok: true,
      details: opened.details,
    });
  });

  it("keeps old_encryption for a file it cannot rewrite, and leaves a modern file alone", async () => {
    expect(
      await openCertificate(
        Buffer.from(RC4_CANDIDATE.pfxBase64, "base64"),
        RC4_CANDIDATE.passphrase,
        { rewriteOld: true },
      ),
    ).toEqual({ ok: false, reason: "old_encryption" });
    expect(
      await openCertificate(candidate.pfx, candidate.passphrase, { rewriteOld: true }),
    ).toEqual(openCertificateFile(candidate.pfx, candidate.passphrase));
  });
});

it("keeps a UTF-8 passphrase when stdin splits inside its character", async () => {
  const authority = makeAuthority();
  const root = await mkdtemp(join(tmpdir(), "certificate-unicode-"));
  try {
    const pem = join(root, "private.pem");
    await writeFile(pem, authority.serverKeyPem + authority.serverCertPem, { mode: 0o600 });
    const passphrase = "private ñandú";
    const pfx = execFileSync("openssl", ["pkcs12", "-export", "-in", pem, "-passout", "stdin"], {
      input: passphrase + "\n",
      timeout: 10_000,
    });
    const file = { pfx, passphrase };
    const control = openCertificateFile(file.pfx, file.passphrase);
    expect(control).toMatchObject({ ok: true });
    const input = Buffer.from(
      JSON.stringify({ pfx: file.pfx.toString("base64"), passphrase: file.passphrase }),
    );
    const split = input.indexOf(Buffer.from("ñ")) + 1;
    const script = `
    const iterator = process.stdin[Symbol.asyncIterator].bind(process.stdin);
    process.stdin[Symbol.asyncIterator] = async function* () {
      for await (const chunk of {[Symbol.asyncIterator]:iterator}) { yield chunk; process.stderr.write("__WAITRON_STDIN_CHUNK_READ__"); }
    };
    await import(${JSON.stringify(new URL("./certificate-open-entry.ts", import.meta.url).href)});
  `;
    const child = spawn(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", script],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    const closed = once(child, "close");
    try {
      const consumed = new Promise<void>((resolve) => {
        let seen = "";
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          seen += chunk;
          if (seen.includes("__WAITRON_STDIN_CHUNK_READ__")) resolve();
        });
      });
      child.stdin.write(input.subarray(0, split));
      await Promise.race([
        consumed,
        closed.then(() => {
          throw new Error("child closed before consuming input");
        }),
      ]);
      child.stdin.end(input.subarray(split));
      await closed;
      expect(JSON.parse(output)).toMatchObject({ ok: true });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await closed;
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("distinguishes a child that cannot run from an unreadable certificate", async () => {
  const node = process.execPath;
  try {
    process.execPath = "/nonexistent/waitron-node";
    expect(await openCertificate(candidate.pfx, candidate.passphrase)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  } finally {
    process.execPath = node;
  }
});

it("reports a synchronous launch refusal as unavailable", async () => {
  vi.mocked(spawn).mockImplementationOnce(() => {
    throw Object.assign(new Error("child launch refused"), { code: "ERR_ACCESS_DENIED" });
  });
  await expect(openCertificate(candidate.pfx, candidate.passphrase)).resolves.toEqual({
    ok: false,
    reason: "unavailable",
  });
});
