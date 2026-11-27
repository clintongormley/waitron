const RETIRED_KEY = ["WAITRON", "ACCOUNT", "KEY"].join("_");
import { createPrivateKey, X509Certificate } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import forge from "node-forge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { certificate } from "@waitron/server-kit/certificate.js";
import { loadKeyRing } from "@waitron/credentials";
import * as credentialReaders from "@waitron/credentials";
import * as boxReaders from "./box-env.js";
import * as identityReaders from "./restore.js";
import * as configReaders from "./backup-config.js";
import * as cipherReaders from "./artifact-cipher.js";
import * as archiveReaders from "./backup-archive.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import { encryptArtifactAsync } from "./artifact-cipher.js";
import { loadBoxEnv } from "./box-env.js";
import { issueClientCert, mintSelfSignedServerCert } from "./self-signed-cert.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import {
  verifyBackupKeyPlacement,
  verifyBackupStateSecrets,
} from "./backup-verification-secrets.js";

const source = {
  nodeId: "20000000-0000-4000-8000-000000000002",
};
const now = new Date("2026-10-20T10:00:00.000Z");
const key = Buffer.alloc(32, 19).toString("base64");
const otherKey = Buffer.alloc(32, 23).toString("base64");
const account = Buffer.alloc(32, 29).toString("base64");
const pass = { status: "passed", reason: "none" };
const invalid = { status: "invalid", reason: "secret_invalid" };
const unsupported = { status: "unsupported", reason: "secret_format_unsupported" };
const unavailable = { status: "unavailable", reason: "secret_unavailable" };
const caKeys = forge.pki.rsa.generateKeyPair(2048);
const serverKeys = forge.pki.rsa.generateKeyPair(2048);
const validity = {
  notBefore: new Date("2026-01-01T00:00:00.000Z"),
  notAfter: new Date("2030-01-01T00:00:00.000Z"),
};
const issuer = { cn: "Verification test CA", key: caKeys.privateKey };
const ca = certificate(issuer.cn, caKeys, issuer, "01", validity, [
  { name: "basicConstraints", cA: true },
  { name: "keyUsage", keyCertSign: true },
]);
const leaf = certificate("verification.test", serverKeys, issuer, "02", validity, [
  { name: "basicConstraints", cA: false },
  { name: "extKeyUsage", serverAuth: true },
]);
const pem = forge.pki.certificateToPem;
const privatePem = forge.pki.privateKeyToPem;
const signerKeys = forge.pki.rsa.generateKeyPair(2048);
const tlsKeys = [caKeys, signerKeys, serverKeys].values();
const material = mintSelfSignedServerCert({
  hostnames: ["waitron.local"],
  ipAddresses: ["127.0.0.1"],
  now,
  keypair: () => tlsKeys.next().value!,
});
const signerPem = forge.pem.encode(forge.pem.decode(material.caKeyPem)[0]!);
const signer = forge.pki.certificateFromPem(signerPem);
const issuerName = String(signer.subject.getField("CN").value);
function entries(): ArchiveEntry[] {
  return Object.entries({
    "secrets.env": `WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_CREDENTIALS_KEY_VERSION=2\n`,
    "trading.env": `WAITRON_NODE_ID=${source.nodeId}\nWAITRON_ENV=preproduction\n${RETIRED_KEY}=${account}\n`,
    "tls/ca.crt": material.caCertPem,
    "tls/ca.key": material.caKeyPem,
    "tls/server.pem": material.serverCertPem + material.serverKeyPem,
  }).map(([name, text]) => ({ name: "secrets/" + name, bytes: Buffer.from(text) }));
}
function set(input: ArchiveEntry[], name: string, text: string): ArchiveEntry[] {
  return [
    ...input.filter((e) => e.name !== "secrets/" + name),
    { name: "secrets/" + name, bytes: Buffer.from(text) },
  ];
}
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function place(input: ArchiveEntry[]) {
  const root = await mkdtemp(join(tmpdir(), "a850-private-key-sentinel-"));
  roots.push(root);
  for (const entry of input) {
    if (entry.name === "secrets/backup.env") continue;
    const path = join(root, entry.name.slice("secrets/".length));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.bytes);
  }
  return root;
}
async function seal(input: ArchiveEntry[]) {
  return {
    sealed: await encryptArtifactAsync(packArchive(input), "private-archive-key-sentinel"),
    archiveKey: "private-archive-key-sentinel",
  };
}

describe("private host recovery material", () => {
  it("refuses an entry under secrets/cloud/", async () => {
    expect(
      await verifyBackupStateSecrets(
        set(entries(), "cloud/connection.json", "private-cloud-sentinel"),
        source,
        now,
      ),
    ).toEqual(unsupported);
  });
  it("accepts complete matching state with no selected-node sealed row", async () => {
    expect(await verifyBackupStateSecrets(entries(), source, now)).toEqual(pass);
  });
  it("refuses an old root whose private key is still in the backup", async () => {
    const old = set(
      set(set(entries(), "tls/ca.crt", pem(ca)), "tls/ca.key", privatePem(caKeys.privateKey)),
      "tls/server.pem",
      pem(leaf) + privatePem(serverKeys.privateKey),
    );
    expect(await verifyBackupStateSecrets(old, source, now)).toEqual(invalid);
  });
  it("refuses a client-only certificate in the backed-up serving identity", async () => {
    const client = issueClientCert({ ...material, hostname: "waitron.local", now });
    const state = set(entries(), "tls/server.pem", client.clientCertPem + client.clientKeyPem);
    expect(await verifyBackupStateSecrets(state, source, now)).toEqual(invalid);
  });
  it.each(RECOVERY_FILES)("requires recovery file %s", async (name) => {
    expect(
      await verifyBackupStateSecrets(
        entries().filter((e) => e.name !== "secrets/" + name),
        source,
        now,
      ),
    ).toEqual(unavailable);
  });
  it.each(RECOVERY_FILES)("refuses an empty recovery file %s", async (name) => {
    expect(await verifyBackupStateSecrets(set(entries(), name, ""), source, now)).toEqual(
      unavailable,
    );
  });
  it("refuses duplicate recovery entries", async () => {
    const input = entries();
    input.push(input[0]!);
    expect(await verifyBackupStateSecrets(input, source, now)).toEqual(invalid);
  });
  it.each([
    "secrets.env",
    "trading.env",
    "tls/ca.crt",
    "tls/ca.key",
    "tls/server.pem",
    "tls/server.pem",
  ])("refuses unusable bytes in %s", async (name) => {
    const expected = name === "secrets.env" ? unavailable : invalid;
    expect(
      await verifyBackupStateSecrets(
        set(entries(), name, "private-malformed-sentinel"),
        source,
        now,
      ),
    ).toEqual(expected);
  });
  it.each(["tls/ca.key", "tls/server.pem"])(
    "matches parseable private key %s to its certificate",
    async (name) => {
      const wrong = name === "tls/ca.key" ? serverKeys.privateKey : caKeys.privateKey;
      const encoded = privatePem(wrong);
      expect(createPrivateKey(encoded).type).toBe("private");
      const certificateChain = name === "tls/ca.key" ? signerPem : material.serverCertPem;
      expect(
        await verifyBackupStateSecrets(
          set(entries(), name, certificateChain + encoded),
          source,
          now,
        ),
      ).toEqual(invalid);
    },
  );
  it("checks the server signature even when the issuer name matches", async () => {
    const wrong = certificate(
      "verification.test",
      serverKeys,
      { cn: issuerName, key: serverKeys.privateKey },
      "03",
      validity,
      [
        { name: "basicConstraints", cA: false },
        { name: "extKeyUsage", serverAuth: true },
      ],
    );
    expect(new X509Certificate(pem(wrong)).issuer).toBe(new X509Certificate(signerPem).subject);
    const wrongChain = pem(wrong) + signerPem + material.serverKeyPem;
    expect(
      await verifyBackupStateSecrets(set(entries(), "tls/server.pem", wrongChain), source, now),
    ).toEqual(invalid);
  });
  it("requires a CA certificate rather than a matching self-signed leaf", async () => {
    const wrong = certificate(issuer.cn, caKeys, issuer, "04", validity, [
      { name: "basicConstraints", cA: false },
    ]);
    expect(
      await verifyBackupStateSecrets(set(entries(), "tls/ca.crt", pem(wrong)), source, now),
    ).toEqual(invalid);
  });
  it("reports a self-signed root using an unsupported key algorithm as invalid", async () => {
    const ecRoot = `-----BEGIN CERTIFICATE-----
MIIBfTCCASOgAwIBAgIUQpbXa26WB3/3g2FB12HLn2nRmlkwCgYIKoZIzj0EAwIw
GzEZMBcGA1UEAwwQd2FpdHJvbi1zZXR1cC1jYTAeFw0yNjExMjYxMDI5MjBaFw0z
NjExMjMxMDI5MjBaMBsxGTAXBgNVBAMMEHdhaXRyb24tc2V0dXAtY2EwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAAR5y/3nUrAY6cJIM5F+fE7qBogVvcW/qakoHj+I
aucE4IG+fD1FPUKUR38nn7lBUHiGOl3kpoFiHWk7dLrS1VQ8o0UwQzAdBgNVHQ4E
FgQUZVrs7c3swpA9Ho3n35Vm0xZEOlYwEgYDVR0TAQH/BAgwBgEB/wIBATAOBgNV
HQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgXqTyCA1iw58dta4PYdtedJJC
b1YaBIhopZ0LIDXrxKYCIQCuPZWAIRmOhl5lML4OTrvojcISBlszAvEXOD2kZaxb
Jg==
-----END CERTIFICATE-----
`;
    const cert = new X509Certificate(ecRoot);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.publicKey.asymmetricKeyType).toBe("ec");
    expect(
      await verifyBackupStateSecrets(
        set(entries(), "tls/ca.crt", ecRoot),
        source,
        cert.validFromDate,
      ),
    ).toEqual(invalid);
  });
  it("refuses a CA whose own signature is damaged", async () => {
    const cert = forge.pki.certificateFromPem(material.caCertPem);
    cert.sign(serverKeys.privateKey, forge.md.sha256.create());
    expect(
      await verifyBackupStateSecrets(set(entries(), "tls/ca.crt", pem(cert)), source, now),
    ).toEqual(invalid);
  });
  it.each(["2025-01-01T00:00:00.000Z", "2040-01-01T00:00:00.000Z"])(
    "treats renewal at %s as unavailable rather than damaged key material",
    async (at) => {
      expect(await verifyBackupStateSecrets(entries(), source, new Date(at))).toEqual(unavailable);
    },
  );
  it.each(["WAITRON_NODE_ID"])("binds captured %s to the source", async (name) => {
    const input = entries();
    const item = input.find((e) => e.name === "secrets/trading.env")!;
    item.bytes = Buffer.from(
      Buffer.from(item.bytes)
        .toString()
        .replace(new RegExp(`${name}=.*`), `${name}=30000000-0000-4000-8000-000000000003`),
    );
    expect(await verifyBackupStateSecrets(input, source, now)).toEqual({
      status: "invalid",
      reason: "binding_mismatch",
    });
  });
  it("ignores a retired key in captured configuration", async () => {
    expect(
      await verifyBackupStateSecrets(
        set(entries(), "trading.env", `WAITRON_NODE_ID=${source.nodeId}\n${RETIRED_KEY}=bad`),
        source,
        now,
      ),
    ).toEqual(pass);
  });
  it("accepts optional backup settings without accessing the old destination", async () => {
    const input = set(
      entries(),
      "backup.env",
      "ARCHIVE_FOLDER=/private-old-destination-sentinel\nWAITRON_BACKUP_RECOVERY_KEY=private-backup-key-sentinel\n",
    );
    expect(await verifyBackupStateSecrets(input, source, now)).toEqual(pass);
    const dir = await place(input);
    expect(await readdir(dir)).not.toContain("backup.env");
    expect(await verifyBackupKeyPlacement(input, dir)).toBe("passed");
  });

  it.each(["WAITRON_BACKUP_RECOVERY_KEY=short\n"])(
    "refuses malformed optional backup settings %#",
    async (value) => {
      expect(
        await verifyBackupStateSecrets(set(entries(), "backup.env", value), source, now),
      ).toEqual(unsupported);
    },
  );

  it.each(["cloud/connection.json", "cloud/staff.key", "cloud/staff.json", "cloud/staff.session"])(
    "refuses archived Cloud authority %s",
    async (name) => {
      expect(
        await verifyBackupStateSecrets(
          set(entries(), name, "private-cloud-secret-sentinel"),
          source,
          now,
        ),
      ).toEqual(unsupported);
    },
  );
  it.each([
    ["a missing saved key", entries()],
    ["an empty saved key", set(entries(), "backup.env", "WAITRON_BACKUP_RECOVERY_KEY=\n")],
  ])("authenticates the selected node's sealed state with %s", async (_label, input) => {
    expect(await verifyBackupStateSecrets(input, source, now, await seal(entries()))).toEqual(pass);
  });
  it("ignores a backup key in the wrong box settings file", async () => {
    const original = entries();
    const trading = original.find((entry) => entry.name === "secrets/trading.env")!;
    const input = set(
      set(
        original,
        "trading.env",
        Buffer.from(trading.bytes).toString("utf8") +
          "WAITRON_BACKUP_RECOVERY_KEY=wrong-private-key-sentinel\n",
      ),
      "backup.env",
      "WAITRON_BACKUP_KEY_NUMBER=1\n",
    );
    expect(await verifyBackupStateSecrets(input, source, now, await seal(original))).toEqual(pass);
  });
  it("refuses a wrong saved box key even when the archive key could open the sealed row", async () => {
    const input = set(
      entries(),
      "backup.env",
      "WAITRON_BACKUP_RECOVERY_KEY=wrong-private-key-sentinel\n",
    );
    expect(await verifyBackupStateSecrets(input, source, now, await seal(entries()))).toEqual({
      status: "unavailable",
      reason: "decryption_unavailable",
    });
  });
  it("a wrong key for selected-node state stays unavailable", async () => {
    const sealedState = await seal(entries());
    sealedState.archiveKey = "wrong-private-key-sentinel";
    expect(await verifyBackupStateSecrets(entries(), source, now, sealedState)).toEqual({
      status: "unavailable",
      reason: "decryption_unavailable",
    });
  });
  it("a damaged authentication tag stays unavailable", async () => {
    const sealedState = await seal(entries());
    sealedState.sealed[sealedState.sealed.length - 1] ^= 1;
    expect(await verifyBackupStateSecrets(entries(), source, now, sealedState)).toEqual({
      status: "unavailable",
      reason: "decryption_unavailable",
    });
  });
  it("checks the selected sealed node identity after decryption", async () => {
    const wrong = set(
      entries(),
      "trading.env",
      "WAITRON_NODE_ID=30000000-0000-4000-8000-000000000003\n",
    );
    expect(await verifyBackupStateSecrets(entries(), source, now, await seal(wrong))).toEqual({
      status: "invalid",
      reason: "binding_mismatch",
    });
  });
  it("does not accept an authenticated but incomplete sealed state", async () => {
    expect(await verifyBackupStateSecrets(entries(), source, now, await seal([]))).toEqual(
      unavailable,
    );
  });
  it("keeps results and logging free of secrets and scratch paths", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const results = [
      await verifyBackupStateSecrets(entries(), source, now, await seal(entries())),
      await verifyBackupStateSecrets(
        set(entries(), "tls/server.pem", "private-malformed-sentinel"),
        source,
        now,
      ),
    ];
    const dir = await place(entries());
    const placement = await verifyBackupKeyPlacement(entries(), dir);
    const published = JSON.stringify([results, placement, stdout.mock.calls, stderr.mock.calls]);
    for (const sentinel of [
      key,
      account,
      privatePem(caKeys.privateKey),
      "private-archive-key-sentinel",
      "private-malformed-sentinel",
      dir,
    ])
      expect(published).not.toContain(sentinel);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("actual private key placement", () => {
  it("compares matching secrets and trading configuration against the actual host loader", async () => {
    const input = entries();
    const dir = await place(input);
    const env = await loadBoxEnv({}, dir);
    expect(loadKeyRing(env).current.key).toEqual(Buffer.from(key, "base64"));
    expect(await verifyBackupKeyPlacement(input, dir)).toBe("passed");
  });
  it("accepts a redundant equal later-file key override", async () => {
    const input = set(
      entries(),
      "backup.env",
      `WAITRON_CREDENTIALS_KEY=${key}\n${RETIRED_KEY}=${account}\n`,
    );
    expect(await verifyBackupKeyPlacement(input, await place(input))).toBe("passed");
  });
  it.each(["WAITRON_CREDENTIALS_KEY", "WAITRON_CREDENTIALS_KEY_VERSION"])(
    "refuses a dropped later-file %s override",
    async (name) => {
      const value = name.endsWith("VERSION") ? "3" : otherKey;
      const input = set(entries(), "backup.env", `${name}=${value}\n`);
      const dir = await place(input);
      expect((await loadBoxEnv({}, dir))[name]).not.toBe(value);
      expect(await verifyBackupKeyPlacement(input, dir)).toBe("unsupported");
    },
  );
  it("ignores a retired key present only in backup.env", async () => {
    const input = set(
      set(entries(), "trading.env", `WAITRON_NODE_ID=${source.nodeId}\n`),
      "backup.env",
      `${RETIRED_KEY}=${account}\n`,
    );
    const dir = await place(input);
    expect(await verifyBackupKeyPlacement(input, dir)).toBe("passed");
  });
  it("accepts matching rings without a retired override", async () => {
    const input = set(entries(), "trading.env", `WAITRON_NODE_ID=${source.nodeId}\n`);
    expect(await verifyBackupKeyPlacement(input, await place(input))).toBe("passed");
  });
  it.each(["WAITRON_CREDENTIALS_KEY_PREVIOUS", "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION"])(
    "compares previous ring material including %s",
    async (name) => {
      const input = set(
        entries(),
        "backup.env",
        `WAITRON_CREDENTIALS_KEY_PREVIOUS=${otherKey}\nWAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION=1\n`,
      );
      const dir = await place(input);
      await writeFile(
        join(dir, "secrets.env"),
        `WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_CREDENTIALS_KEY_VERSION=2\nWAITRON_CREDENTIALS_KEY_PREVIOUS=${name.endsWith("VERSION") ? otherKey : account}\nWAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION=${name.endsWith("VERSION") ? 3 : 1}\n`,
      );
      expect(await verifyBackupKeyPlacement(input, dir)).toBe("unsupported");
    },
  );
  it("accepts an identical previous ring", async () => {
    const input = entries();
    input[0]!.bytes = Buffer.from(
      `WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_CREDENTIALS_KEY_VERSION=2\nWAITRON_CREDENTIALS_KEY_PREVIOUS=${otherKey}\nWAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION=1\n`,
    );
    expect(await verifyBackupKeyPlacement(input, await place(input))).toBe("passed");
  });
  it("a missing placed application key is unavailable with no live env fallback", async () => {
    const input = entries();
    const dir = await place(input);
    await rm(join(dir, "secrets.env"));
    vi.stubEnv("WAITRON_CREDENTIALS_KEY", key);
    try {
      expect(await verifyBackupKeyPlacement(input, dir)).toBe("unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("refuses a valid but different placed application key", async () => {
    const input = entries();
    const dir = await place(input);
    await writeFile(
      join(dir, "secrets.env"),
      `WAITRON_CREDENTIALS_KEY=${otherKey}\nWAITRON_CREDENTIALS_KEY_VERSION=2\n`,
    );
    expect(await readFile(join(dir, "secrets.env"), "utf8")).toContain(otherKey);
    expect(await verifyBackupKeyPlacement(input, dir)).toBe("unsupported");
  });
});

it("does not classify an unreadable sealed frame as a wrong key", async () => {
  expect(
    await verifyBackupStateSecrets(entries(), source, now, {
      sealed: Buffer.from("private-frame-sentinel"),
      archiveKey: "private-key-sentinel",
    }),
  ).toEqual(invalid);
});
it("refuses authenticated plaintext that is not an archive", async () => {
  const sealed = await encryptArtifactAsync(
    Buffer.from("private-plaintext-sentinel"),
    "private-key-sentinel",
  );
  expect(
    await verifyBackupStateSecrets(entries(), source, now, {
      sealed,
      archiveKey: "private-key-sentinel",
    }),
  ).toEqual(invalid);
});
it("requires the captured vault key independently of the key-free trading identity", async () => {
  const dir = await place(entries());
  for (const name of ["secrets/secrets.env", "secrets/trading.env"]) {
    const captured = entries().filter((e) => e.name !== name);
    expect(await verifyBackupKeyPlacement(captured, dir)).toBe(
      name.endsWith("trading.env") ? "passed" : "unavailable",
    );
  }
});
it("a vault key supplied only by excluded backup.env is an unsupported layout", async () => {
  const input = set(
    set(entries(), "secrets.env", "# externally supplied application key\n"),
    "backup.env",
    `WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_CREDENTIALS_KEY_VERSION=2\n`,
  );
  expect(await verifyBackupKeyPlacement(input, await place(input))).toBe("unsupported");
});
it("does not accept a non-finite verification clock", async () => {
  expect(await verifyBackupStateSecrets(entries(), source, new Date(NaN))).toEqual(unavailable);
});
it.each(["root", "signer", "server"])("checks the %s validity independently", async (which) => {
  const input = entries();
  const expired = new Date(now.getTime() - 1000);
  if (which === "root") {
    const root = forge.pki.certificateFromPem(material.caCertPem);
    root.validity.notAfter = expired;
    root.sign(caKeys.privateKey, forge.md.sha256.create());
    expect(
      await verifyBackupStateSecrets(set(input, "tls/ca.crt", pem(root)), source, now),
    ).toEqual(unavailable);
    return;
  }
  const server = forge.pki.certificateFromPem(material.serverCertPem);
  if (which === "server") {
    server.validity.notAfter = expired;
    server.sign(signerKeys.privateKey, forge.md.sha256.create());
    const chain = pem(server) + signerPem + material.serverKeyPem;
    expect(
      await verifyBackupStateSecrets(set(input, "tls/server.pem", chain), source, now),
    ).toEqual(unavailable);
    return;
  }
  const intermediate = forge.pki.certificateFromPem(signerPem);
  intermediate.validity.notAfter = expired;
  intermediate.sign(caKeys.privateKey, forge.md.sha256.create());
  const chain = pem(server) + pem(intermediate) + material.serverKeyPem;
  const signing = pem(intermediate) + privatePem(signerKeys.privateKey);
  expect(
    await verifyBackupStateSecrets(
      set(set(input, "tls/ca.key", signing), "tls/server.pem", chain),
      source,
      now,
    ),
  ).toEqual(unavailable);
});
it.each(["placement", "identity", "keyring", "settings", "decrypt", "archive"])(
  "an unexpected %s fault is not a completed integrity verdict",
  async (boundary) => {
    const fault = new Error("private-unexpected-error-sentinel");
    const input = entries();
    const state = boundary === "decrypt" || boundary === "archive" ? await seal(input) : undefined;
    if (boundary === "placement") {
      vi.spyOn(boxReaders, "loadBoxEnv").mockRejectedValueOnce(fault);
      await expect(verifyBackupKeyPlacement(input, await place(input))).rejects.toBe(fault);
      return;
    }
    if (boundary === "identity")
      vi.spyOn(identityReaders, "readArtifactIdentity").mockImplementationOnce(() => {
        throw fault;
      });
    if (boundary === "keyring")
      vi.spyOn(credentialReaders, "loadKeyRing").mockImplementationOnce(() => {
        throw fault;
      });
    if (boundary === "settings")
      vi.spyOn(configReaders, "loadRecoveryKey").mockImplementationOnce(() => {
        throw fault;
      });
    if (boundary === "decrypt")
      vi.spyOn(cipherReaders, "decryptArtifactAsync").mockImplementationOnce(() => {
        throw fault;
      });
    if (boundary === "archive")
      vi.spyOn(archiveReaders, "unpackArchive").mockImplementationOnce(() => {
        throw fault;
      });
    await expect(verifyBackupStateSecrets(input, source, now, state)).rejects.toBe(fault);
  },
);

it("checks the server issuer name as well as its signature", async () => {
  const wrong = certificate(
    "verification.test",
    serverKeys,
    { cn: "Different test CA", key: signerKeys.privateKey },
    "07",
    validity,
    [
      { name: "basicConstraints", cA: false },
      { name: "extKeyUsage", serverAuth: true },
    ],
  );
  expect(new X509Certificate(pem(wrong)).verify(new X509Certificate(signerPem).publicKey)).toBe(
    true,
  );
  const wrongChain = pem(wrong) + signerPem + material.serverKeyPem;
  expect(
    await verifyBackupStateSecrets(set(entries(), "tls/server.pem", wrongChain), source, now),
  ).toEqual(invalid);
});
it("ignores a redundant retired key in backup.env", async () => {
  const input = set(entries(), "trading.env", `WAITRON_NODE_ID=${source.nodeId}\n`);
  const dir = await place(input);
  expect(
    await verifyBackupKeyPlacement(set(input, "backup.env", `${RETIRED_KEY}=${account}\n`), dir),
  ).toBe("passed");
});

it("an unexpected TLS reader fault is not reported as damaged key material", async () => {
  const fault = new Error("private-crypto-fault-sentinel");
  vi.spyOn(X509Certificate.prototype, "checkPrivateKey").mockImplementationOnce(() => {
    throw fault;
  });
  await expect(verifyBackupStateSecrets(entries(), source, now)).rejects.toBe(fault);
});
