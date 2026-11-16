import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
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
      for await (const chunk of {[Symbol.asyncIterator]:iterator}) { yield chunk; process.stderr.write("read"); }
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
      const consumed = once(child.stderr, "data");
      child.stdin.write(input.subarray(0, split));
      await consumed;
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
