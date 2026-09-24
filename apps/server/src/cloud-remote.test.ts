import { expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mountCloudPublic, createStaffCsr } from "./cloud-remote.js";
import forge from "node-forge";
it("public availability exposes no venue data and reevaluates its supplied serving check", async () => {
  const app = new Hono();
  let serving = true;
  mountCloudPublic(app, () => serving);
  const ok = await app.request("/public/availability");
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ available: true });
  serving = false;
  const offline = await app.request("/public/availability");
  expect(offline.status).toBe(503);
  expect(await offline.json()).toEqual({ available: false });
  expect((await app.request("/public/availability", { method: "POST" })).status).toBe(404);
});
it("staff key remains private on the venue and repeated requests retain its identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-cloud-key-"));
  try {
    const first = await createStaffCsr(root, "staff.sol.example.test"),
      second = await createStaffCsr(root, "staff.sol.example.test");
    const key = await readFile(join(root, "cloud-staff.key"), "utf8");
    expect(first).not.toContain("PRIVATE KEY");
    expect((await stat(join(root, "cloud-staff.key"))).mode & 0o077).toBe(0);
    const one = forge.pki.certificationRequestFromPem(first),
      two = forge.pki.certificationRequestFromPem(second);
    expect(one.verify()).toBe(true);
    expect(two.verify()).toBe(true);
    expect(forge.pki.publicKeyToPem(one.publicKey!)).toBe(forge.pki.publicKeyToPem(two.publicKey!));
    expect(key).toContain("PRIVATE KEY");
    const { RECOVERY_FILES, collectStateSecrets } = await import("./state-secrets.js");
    for (const relative of RECOVERY_FILES) {
      await mkdir(dirname(join(root, relative)), { recursive: true });
      await writeFile(join(root, relative), "recovery fixture");
    }
    const captured = await collectStateSecrets(root);
    expect(captured).not.toHaveProperty("cloud-staff.key");
    expect(JSON.stringify(captured)).not.toContain(key);
    await expect(createStaffCsr(root, "*.example.test")).rejects.toThrow("Invalid staff hostname");
    await writeFile(join(root, "cloud-staff.key"), "broken");
    await expect(createStaffCsr(root, "staff.sol.example.test")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("certificate installation verifies the venue key and hostname before replacing a valid chain", async () => {
  const { installStaffCertificate } = await import("./cloud-remote.js");
  const root = await mkdtemp(join(tmpdir(), "waitron-cloud-cert-"));
  try {
    const csr = forge.pki.certificationRequestFromPem(
      await createStaffCsr(root, "staff.sol.example.test"),
    );
    const key = forge.pki.privateKeyFromPem(await readFile(join(root, "cloud-staff.key"), "utf8"));
    const cert = forge.pki.createCertificate();
    cert.publicKey = csr.publicKey!;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 1000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: "commonName", value: "staff.sol.example.test" }]);
    cert.setIssuer(cert.subject.attributes);
    cert.setExtensions([
      { name: "subjectAltName", altNames: [{ type: 2, value: "staff.sol.example.test" }] },
    ]);
    cert.sign(key, forge.md.sha256.create());
    const pem = forge.pki.certificateToPem(cert);
    await installStaffCertificate(root, "staff.sol.example.test", pem);
    await chmod(join(root, "cloud-staff.key"), 0o666);
    await expect(installStaffCertificate(root, "staff.sol.example.test", pem)).rejects.toThrow(
      "Invalid staff key file",
    );
    await expect(createStaffCsr(root, "staff.sol.example.test")).rejects.toThrow(
      "Invalid staff key file",
    );
    await chmod(join(root, "cloud-staff.key"), 0o600);
    await expect(installStaffCertificate(root, "staff.luna.example.test", pem)).rejects.toThrow();
    await expect(
      installStaffCertificate(root, "staff.sol.example.test", "broken"),
    ).rejects.toThrow();
    const other = forge.pki.rsa.generateKeyPair(2048);
    cert.publicKey = other.publicKey;
    cert.sign(other.privateKey, forge.md.sha256.create());
    await expect(
      installStaffCertificate(root, "staff.sol.example.test", forge.pki.certificateToPem(cert)),
    ).rejects.toThrow();
    expect(await readFile(join(root, "cloud-staff.crt"), "utf8")).toBe(pem);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("the certificate CLI reports an invalid chain without a Node stack trace", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(join(tmpdir(), "waitron-cert-cli-"));
  try {
    await writeFile(join(root, "chain.pem"), "broken");
    const result = await promisify(execFile)(process.execPath, [
      "--import",
      import.meta.resolve("tsx"),
      "scripts/cloud-certificate.ts",
      "install",
      root,
      "staff.example.test",
      join(root, "chain.pem"),
    ]).catch((error: { code: number; stderr: string }) => error);
    expect(result).toHaveProperty("code", 1);
    expect(result.stderr).toContain("Could not install the staff certificate");
    expect(result.stderr).not.toContain("node:internal");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
