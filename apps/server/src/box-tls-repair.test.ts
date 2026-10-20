import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureContext } from "node:tls";
import forge from "node-forge";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mintSelfSignedServerCert, type SelfSignedMaterial } from "./self-signed-cert.js";
import { inspectBoxTls, repairBoxTls } from "./box-tls-repair.js";
import { ensureBoxSecrets, reissueBoxLeaf } from "./box-secrets.js";

const faults = vi.hoisted(() => ({ rename: vi.fn(), open: vi.fn() }));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  faults.rename.mockImplementation(real.rename);
  faults.open.mockImplementation(real.open);
  return { ...real, rename: faults.rename, open: faults.open };
});
const now = new Date("2026-10-21T00:00:00Z");
const names = ["waitron.local", "localhost"];
const pemNames = ["ca.crt", "ca.key", "server.crt", "server.key"] as const;
const dirs: string[] = [];
let keys: forge.pki.rsa.KeyPair;
let otherKeys: forge.pki.rsa.KeyPair;
let material: SelfSignedMaterial;
beforeAll(() => {
  keys = forge.pki.rsa.generateKeyPair(2048);
  otherKeys = forge.pki.rsa.generateKeyPair(2048);
  let generated = 0;
  material = mintSelfSignedServerCert({
    hostnames: names,
    ipAddresses: ["127.0.0.1", "192.168.1.50"],
    now,
    keypair: () => (generated++ === 0 ? keys : otherKeys),
  });
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(initial: SelfSignedMaterial | null = material) {
  const stateDir = await mkdtemp(join(tmpdir(), "tls-repair-"));
  dirs.push(stateDir);
  await mkdir(join(stateDir, "tls"));
  if (initial) {
    const values = [
      initial.caCertPem,
      initial.caKeyPem,
      initial.serverCertPem,
      initial.serverKeyPem,
    ];
    for (const [i, name] of pemNames.entries())
      await writeFile(join(stateDir, "tls", name), values[i]!);
  }
  await writeFile(join(stateDir, "secrets.env"), "retained-vault-key\n");
  await writeFile(join(stateDir, "first-setup.json"), "retained-attempt\n");
  return {
    stateDir,
    hostnames: names,
    listIpv4: () => ["192.168.1.50", "100.64.1.2"],
    now: () => now,
  };
}
async function contents(stateDir: string) {
  return Object.fromEntries(
    await Promise.all(
      pemNames.map(async (name) => [name, await readFile(join(stateDir, "tls", name))]),
    ),
  );
}
async function archive(stateDir: string) {
  const root = join(stateDir, "tls", "repair-archive");
  const entries = await readdir(root);
  expect(entries).toHaveLength(1);
  const folder = join(root, entries[0]!);
  return { folder, manifest: JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")) };
}
async function validInstalled(stateDir: string, ca = material.caCertPem) {
  const leafPem = await readFile(join(stateDir, "tls", "server.crt"));
  const keyPem = await readFile(join(stateDir, "tls", "server.key"));
  const leaf = new X509Certificate(leafPem);
  expect(leaf.verify(new X509Certificate(ca).publicKey)).toBe(true);
  expect(leaf.checkPrivateKey(createPrivateKey(keyPem))).toBe(true);
  expect(leaf.checkHost("waitron.local")).toBe("waitron.local");
  expect(leaf.checkHost("localhost")).toBe("localhost");
  expect(leaf.checkIP("192.168.1.50")).toBe("192.168.1.50");
  expect(leaf.checkIP("100.64.1.2")).toBeUndefined();
  expect(Date.parse(leaf.validFrom)).toBeLessThanOrEqual(now.getTime());
  expect(Date.parse(leaf.validTo)).toBeGreaterThan(now.getTime());
  expect(() => createSecureContext({ key: keyPem, cert: leafPem })).not.toThrow();
}

it("preserves a usable CA and every old byte when the server key is lost", async () => {
  const f = await fixture();
  await rm(join(f.stateDir, "tls", "server.key"));
  await writeFile(join(f.stateDir, "tls", "server.crt.previous"), Buffer.from([0, 255, 1]));
  expect(await inspectBoxTls(f)).toMatchObject({
    state: "repair-required",
    trust: "retained",
    caAvailable: true,
  });
  expect(await repairBoxTls(f)).toMatchObject({
    state: "healthy",
    trust: "retained",
    caAvailable: true,
  });
  expect(await readFile(join(f.stateDir, "tls", "ca.crt"), "utf8")).toBe(material.caCertPem);
  expect(await readFile(join(f.stateDir, "tls", "ca.key"), "utf8")).toBe(material.caKeyPem);
  const saved = await archive(f.stateDir);
  expect(await readFile(join(saved.folder, "server.crt"), "utf8")).toBe(material.serverCertPem);
  expect(await readFile(join(saved.folder, "server.crt.previous"))).toEqual(
    Buffer.from([0, 255, 1]),
  );
  expect(saved.manifest.absent).toContain("server.key");
  await validInstalled(f.stateDir);
  expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe("retained-vault-key\n");
  expect(await readFile(join(f.stateDir, "first-setup.json"), "utf8")).toBe("retained-attempt\n");
});

it.each(["missing-cert", "malformed", "expired", "mismatched", "wrong-host", "wrong-ip"])(
  "repairs a %s leaf under its retained CA",
  async (damage) => {
    const f = await fixture();
    if (damage === "missing-cert") await rm(join(f.stateDir, "tls", "server.crt"));
    if (damage === "malformed")
      await writeFile(join(f.stateDir, "tls", "server.crt"), "broken leaf");
    if (damage === "mismatched")
      await writeFile(
        join(f.stateDir, "tls", "server.key"),
        forge.pki.privateKeyToPem(keys.privateKey),
      );
    if (["expired", "wrong-host", "wrong-ip"].includes(damage)) {
      const { reissueServerLeaf } = await import("./self-signed-cert.js");
      const leaf = reissueServerLeaf({
        ...material,
        hostnames: damage === "wrong-host" ? ["localhost"] : names,
        ipAddresses: damage === "wrong-ip" ? [] : ["127.0.0.1", "192.168.1.50"],
        now: damage === "expired" ? new Date("2010-01-01T00:00:00Z") : now,
        keypair: () => otherKeys,
      });
      await writeFile(join(f.stateDir, "tls", "server.crt"), leaf.serverCertPem);
    }
    expect(await inspectBoxTls(f)).toMatchObject({ state: "repair-required", trust: "retained" });
    expect(await repairBoxTls(f)).toMatchObject({ state: "healthy", trust: "retained" });
    await validInstalled(f.stateDir);
  },
);

it.each([
  "missing-cert",
  "missing-key",
  "malformed",
  "malformed-key",
  "expired",
  "future",
  "mismatched",
  "not-ca",
  "bad-signature",
])("requires new trust when the retained authority is %s", async (damage) => {
  const f = await fixture();
  await rm(join(f.stateDir, "tls", "server.key"));
  if (damage === "missing-cert") await rm(join(f.stateDir, "tls", "ca.crt"));
  if (damage === "missing-key") await rm(join(f.stateDir, "tls", "ca.key"));
  if (damage === "malformed") await writeFile(join(f.stateDir, "tls", "ca.crt"), "broken CA");
  if (damage === "malformed-key")
    await writeFile(join(f.stateDir, "tls", "ca.key"), "broken private key");
  if (damage === "mismatched")
    await writeFile(
      join(f.stateDir, "tls", "ca.key"),
      forge.pki.privateKeyToPem(otherKeys.privateKey),
    );
  if (damage === "not-ca")
    await writeFile(join(f.stateDir, "tls", "ca.crt"), material.serverCertPem);
  if (damage === "expired") {
    const old = mintSelfSignedServerCert({
      hostnames: names,
      ipAddresses: [],
      now: new Date("2010-01-01T00:00:00Z"),
      keypair: () => keys,
    });
    await writeFile(join(f.stateDir, "tls", "ca.crt"), old.caCertPem);
  }
  if (damage === "future" || damage === "bad-signature") {
    const changed = forge.pki.certificateFromPem(material.caCertPem);
    if (damage === "future") changed.validity.notBefore = new Date("2030-01-01T00:00:00Z");
    changed.sign(
      damage === "bad-signature" ? otherKeys.privateKey : keys.privateKey,
      forge.md.sha256.create(),
    );
    await writeFile(join(f.stateDir, "tls", "ca.crt"), forge.pki.certificateToPem(changed));
  }
  expect(await inspectBoxTls(f)).toMatchObject({
    state: "repair-required",
    trust: "new-required",
    caAvailable: false,
  });
  expect(await repairBoxTls(f)).toMatchObject({
    state: "healthy",
    trust: "new-required",
    caAvailable: true,
  });
  const ca = await readFile(join(f.stateDir, "tls", "ca.crt"), "utf8");
  expect(ca).not.toBe(material.caCertPem);
  expect(
    new X509Certificate(await readFile(join(f.stateDir, "tls", "server.crt"))).verify(
      new X509Certificate(material.caCertPem).publicKey,
    ),
  ).toBe(false);
  await validInstalled(f.stateDir, ca);
  expect((await archive(f.stateDir)).manifest.absent).toContain("server.key");
});

it("keeps healthy TLS byte-identical even without the CA signing key", async () => {
  const f = await fixture();
  const before = await contents(f.stateDir);
  await rm(join(f.stateDir, "tls", "ca.key"));
  expect(await repairBoxTls(f)).toMatchObject({
    state: "healthy",
    trust: "retained",
    caAvailable: true,
  });
  for (const name of ["ca.crt", "server.crt", "server.key"])
    expect(await readFile(join(f.stateDir, "tls", name))).toEqual(before[name]);
  await expect(stat(join(f.stateDir, "tls", "repair-archive"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("serializes two repairs and makes a healthy repeat a no-op", async () => {
  const f = await fixture(null);
  const settled = await Promise.allSettled([repairBoxTls(f), repairBoxTls({ ...f })]);
  expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  const results = settled.map((result) =>
    result.status === "fulfilled" ? result.value : undefined,
  );
  expect(results).toEqual([results[0], results[0]]);
  expect(results[0]).toMatchObject({ state: "healthy", trust: "new-required" });
  const before = await contents(f.stateDir);
  expect(await repairBoxTls(f)).toEqual(results[0]);
  expect(await contents(f.stateDir)).toEqual(before);
  const { folder } = await archive(f.stateDir);
  expect((await stat(folder)).mode & 0o777).toBe(0o700);
  expect((await stat(join(folder, "manifest.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(join(f.stateDir, "tls", "server.key"))).mode & 0o777).toBe(0o600);
});

it.each(pemNames)(
  "resumes the same candidate after the %s replacement is interrupted",
  async (name) => {
    const f = await fixture(null);
    const original = faults.rename.getMockImplementation()!;
    let rejected = false;
    faults.rename.mockImplementation(async (from, to) => {
      if (!rejected && to === join(f.stateDir, "tls", name)) {
        rejected = true;
        throw Object.assign(new Error("injected rename"), { code: "EIO" });
      }
      return original(from, to);
    });
    try {
      await expect(repairBoxTls(f)).rejects.toBeDefined();
    } finally {
      faults.rename.mockImplementation(original);
    }
    expect(rejected).toBe(true);
    const { folder } = await archive(f.stateDir);
    const candidate = JSON.parse(await readFile(join(folder, "candidate.json"), "utf8"));
    expect(await inspectBoxTls(f)).toMatchObject({
      state: "repair-required",
      trust: "new-required",
    });
    expect(await repairBoxTls({ ...f })).toMatchObject({ state: "healthy", trust: "new-required" });
    expect(await readFile(join(f.stateDir, "tls", "ca.crt"), "utf8")).toBe(candidate.caCertPem);
    expect(await readFile(join(f.stateDir, "tls", "server.crt"), "utf8")).toBe(
      candidate.serverCertPem,
    );
    await archive(f.stateDir);
  },
);

it("refuses an archive failure before changing any active bytes", async () => {
  const f = await fixture();
  await writeFile(join(f.stateDir, "tls", "server.crt"), "damaged");
  const before = await contents(f.stateDir);
  const original = faults.open.getMockImplementation()!;
  faults.open.mockImplementation(async (path, ...args) => {
    if (String(path).includes("repair-archive"))
      throw Object.assign(new Error("archive refused"), { code: "EACCES" });
    return original(path, ...args);
  });
  try {
    await expect(repairBoxTls(f)).rejects.toBeDefined();
  } finally {
    faults.open.mockImplementation(original);
  }
  expect(await contents(f.stateDir)).toEqual(before);
});

it("reuses a candidate saved just before an interruption, without minting another authority", async () => {
  const f = await fixture(null);
  const original = faults.rename.getMockImplementation()!;
  faults.rename.mockImplementation(async (from, to) => {
    await original(from, to);
    if (String(to).endsWith("/candidate.json"))
      throw Object.assign(new Error("interrupted after candidate rename"), { code: "EIO" });
  });
  try {
    await expect(repairBoxTls(f)).rejects.toBeDefined();
  } finally {
    faults.rename.mockImplementation(original);
  }
  const { folder } = await archive(f.stateDir);
  const candidate = JSON.parse(await readFile(join(folder, "candidate.json"), "utf8"));
  expect(await repairBoxTls({ ...f })).toMatchObject({ state: "healthy", trust: "new-required" });
  expect(await readFile(join(f.stateDir, "tls", "ca.crt"), "utf8")).toBe(candidate.caCertPem);
  await archive(f.stateDir);
});

it("a complete TLS pair waits for the interrupted completion marker before being served", async () => {
  const f = await fixture(null);
  const original = faults.rename.getMockImplementation()!;
  let markers = 0;
  faults.rename.mockImplementation(async (from, to) => {
    if (to === join(f.stateDir, "tls", "repair-pending.json") && ++markers === 2)
      throw Object.assign(new Error("completion marker interrupted"), { code: "EIO" });
    return original(from, to);
  });
  try {
    await expect(repairBoxTls(f)).rejects.toBeDefined();
  } finally {
    faults.rename.mockImplementation(original);
  }
  const before = await contents(f.stateDir);
  expect(await inspectBoxTls(f)).toMatchObject({ state: "repair-required", trust: "new-required" });
  expect(await repairBoxTls({ ...f })).toMatchObject({ state: "healthy", trust: "new-required" });
  expect(await contents(f.stateDir)).toEqual(before);
});

it("refuses linked TLS material without reading or changing its target", async () => {
  const f = await fixture();
  const target = join(f.stateDir, "outside-key");
  await writeFile(target, material.serverKeyPem);
  await rm(join(f.stateDir, "tls", "server.key"));
  await symlink(target, join(f.stateDir, "tls", "server.key"));
  expect(await inspectBoxTls(f)).toMatchObject({ state: "refused" });
  await expect(repairBoxTls(f)).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(target, "utf8")).toBe(material.serverKeyPem);
});

it.each(["nameConstraints", "keyUsage"])(
  "requires new trust when the authority lacks %s",
  async (extension) => {
    const f = await fixture();
    await rm(join(f.stateDir, "tls", "server.key"));
    const ca = forge.pki.certificateFromPem(material.caCertPem);
    ca.setExtensions(
      ca.extensions.filter(
        (entry) =>
          entry.name !== extension &&
          entry.id !== (extension === "nameConstraints" ? "2.5.29.30" : "2.5.29.15"),
      ),
    );
    ca.sign(keys.privateKey, forge.md.sha256.create());
    await writeFile(join(f.stateDir, "tls", "ca.crt"), forge.pki.certificateToPem(ca));
    expect(await inspectBoxTls(f)).toMatchObject({
      state: "repair-required",
      trust: "new-required",
      caAvailable: false,
    });
    expect(await repairBoxTls(f)).toMatchObject({ state: "healthy", trust: "new-required" });
  },
);

it("requires new trust when the retained CA cannot be the issuer used by the box signer", async () => {
  const f = await fixture();
  await rm(join(f.stateDir, "tls", "server.key"));
  const ca = forge.pki.certificateFromPem(material.caCertPem);
  ca.setSubject([{ name: "commonName", value: "different-authority" }]);
  ca.setIssuer([{ name: "commonName", value: "different-authority" }]);
  ca.sign(keys.privateKey, forge.md.sha256.create());
  await writeFile(join(f.stateDir, "tls", "ca.crt"), forge.pki.certificateToPem(ca));
  expect(await inspectBoxTls(f)).toMatchObject({ state: "repair-required", trust: "new-required" });
  expect(await repairBoxTls(f)).toMatchObject({ state: "healthy", trust: "new-required" });
  const installedCa = new X509Certificate(await readFile(join(f.stateDir, "tls", "ca.crt")));
  expect(
    new X509Certificate(await readFile(join(f.stateDir, "tls", "server.crt"))).checkIssued(
      installedCa,
    ),
  ).toBe(true);
});

it.each(["ca.crt", "ca.key", "server.crt", "server.crt.previous", "secrets.env"])(
  "initialization preserves retained %s instead of treating a lost server key as a new box",
  async (retained) => {
    const f = await fixture(null);
    await rm(join(f.stateDir, "secrets.env"));
    const path =
      retained === "secrets.env" ? join(f.stateDir, retained) : join(f.stateDir, "tls", retained);
    await writeFile(path, "original retained bytes");
    await expect(ensureBoxSecrets(f)).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(await readFile(path, "utf8")).toBe("original retained bytes");
    for (const name of pemNames.filter((name) => name !== retained))
      await expect(stat(join(f.stateDir, "tls", name))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("an ordinary leaf reissue refuses to overtake an interrupted guided replacement", async () => {
  const f = await fixture(null);
  const original = faults.rename.getMockImplementation()!;
  faults.rename.mockImplementation(async (from, to) => {
    if (to === join(f.stateDir, "tls", "server.key"))
      throw Object.assign(new Error("interrupted key rename"), { code: "EIO" });
    return original(from, to);
  });
  try {
    await expect(repairBoxTls(f)).rejects.toBeDefined();
  } finally {
    faults.rename.mockImplementation(original);
  }
  const before = await readFile(join(f.stateDir, "tls", "server.crt"));
  await expect(reissueBoxLeaf(f)).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(join(f.stateDir, "tls", "server.crt"))).toEqual(before);
  expect(await repairBoxTls(f)).toMatchObject({ state: "healthy" });
});

it("serializes simultaneous first initialization without mixed secrets or TLS files", async () => {
  const f = await fixture(null);
  await rm(join(f.stateDir, "secrets.env"));
  const mint = vi.fn((options: Parameters<typeof mintSelfSignedServerCert>[0]) =>
    mintSelfSignedServerCert({ ...options, keypair: () => keys }),
  );
  const makeKeyRing = vi.fn(() => ({ key: "A".repeat(43) + "=", version: 1 }));
  const results = await Promise.allSettled([
    ensureBoxSecrets({ ...f, mint, makeKeyRing }),
    ensureBoxSecrets({ ...f, mint, makeKeyRing }),
  ]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  expect(results[0]).toEqual(results[1]);
  expect(mint).toHaveBeenCalledTimes(1);
  expect(makeKeyRing).toHaveBeenCalledTimes(1);
  await validInstalled(f.stateDir, await readFile(join(f.stateDir, "tls", "ca.crt"), "utf8"));
});

it.each(["oversize", "directory", "unreadable"])(
  "refuses %s TLS material instead of treating it as missing",
  async (damage) => {
    const f = await fixture();
    const path = join(f.stateDir, "tls", "server.key");
    if (damage === "oversize") await writeFile(path, Buffer.alloc(131073, 65));
    if (damage === "directory") {
      await rm(path);
      await mkdir(path);
    }
    const original = faults.open.getMockImplementation()!;
    if (damage === "unreadable")
      faults.open.mockImplementation(async (file, ...args) => {
        if (file === path) throw Object.assign(new Error("not readable"), { code: "EACCES" });
        return original(file, ...args);
      });
    try {
      expect(await inspectBoxTls(f)).toEqual({
        state: "refused",
        trust: "new-required",
        caAvailable: false,
      });
      await expect(repairBoxTls(f)).rejects.toBeDefined();
    } finally {
      faults.open.mockImplementation(original);
    }
    await expect(stat(join(f.stateDir, "tls", "repair-archive"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each([
  {},
  { operation: "../../outside", complete: false, trust: "retained" },
  { operation: "a".repeat(36), complete: "yes", trust: "retained" },
  { operation: "a".repeat(36), complete: false, trust: "other" },
])("refuses an invalid pending repair reference %#", async (record) => {
  const f = await fixture();
  const before = await contents(f.stateDir);
  await writeFile(join(f.stateDir, "tls", "repair-pending.json"), JSON.stringify(record));
  expect(await inspectBoxTls(f)).toEqual({
    state: "refused",
    trust: "new-required",
    caAvailable: false,
  });
  await expect(repairBoxTls(f)).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await contents(f.stateDir)).toEqual(before);
});

it("returns only connection facts and the public CA fingerprint", async () => {
  const f = await fixture();
  expect(await inspectBoxTls(f)).toEqual({
    state: "healthy",
    trust: "retained",
    caAvailable: true,
    fingerprint: new X509Certificate(material.caCertPem).fingerprint256,
  });
});
