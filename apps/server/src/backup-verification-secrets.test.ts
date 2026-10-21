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
import { resolveAccountKey } from "./account-key.js";
import { loadBoxEnv } from "./box-env.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import {
  verifyBackupKeyPlacement,
  verifyBackupStateSecrets,
} from "./backup-verification-secrets.js";

const source = {
  nodeId: "20000000-0000-4000-8000-000000000002",
  locationId: "10000000-0000-4000-8000-000000000001",
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
function entries(): ArchiveEntry[] {
  return Object.entries({
    "secrets.env": `WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_CREDENTIALS_KEY_VERSION=2\n`,
    "trading.env": `WAITRON_TILL_NODE_ID=${source.nodeId}\nWAITRON_TILL_LOCATION_ID=${source.locationId}\nWAITRON_ENV=preproduction\nWAITRON_ACCOUNT_KEY=${account}\n`,
    "tls/ca.crt": pem(ca),
    "tls/ca.key": privatePem(caKeys.privateKey),
    "tls/server.crt": pem(leaf),
    "tls/server.key": privatePem(serverKeys.privateKey),
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
    recoveryKey: "private-archive-key-sentinel",
  };
}

describe("private host recovery material", () => {
  it("accepts complete matching state with no selected-node sealed row", async () => {
    expect(await verifyBackupStateSecrets(entries(), source, now)).toEqual(pass);
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
    "tls/server.crt",
    "tls/server.key",
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
  it.each(["tls/ca.key", "tls/server.key"])(
    "matches parseable private key %s to its certificate",
    async (name) => {
      const wrong = name === "tls/ca.key" ? serverKeys.privateKey : caKeys.privateKey;
      const encoded = privatePem(wrong);
      expect(createPrivateKey(encoded).type).toBe("private");
      expect(await verifyBackupStateSecrets(set(entries(), name, encoded), source, now)).toEqual(
        invalid,
      );
    },
  );
  it("checks the server signature even when the issuer name matches", async () => {
    const wrong = certificate(
      "verification.test",
      serverKeys,
      { cn: issuer.cn, key: serverKeys.privateKey },
      "03",
      validity,
      [{ name: "basicConstraints", cA: false }],
    );
    expect(new X509Certificate(pem(wrong)).issuer).toBe(new X509Certificate(pem(ca)).subject);
    expect(
      await verifyBackupStateSecrets(set(entries(), "tls/server.crt", pem(wrong)), source, now),
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
  it("refuses a CA whose own signature is damaged", async () => {
    const cert = forge.pki.certificateFromPem(pem(ca));
    cert.sign(serverKeys.privateKey, forge.md.sha256.create());
    expect(
      await verifyBackupStateSecrets(set(entries(), "tls/ca.crt", pem(cert)), source, now),
    ).toEqual(invalid);
  });
  it.each(["2025-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"])(
    "treats renewal at %s as unavailable rather than damaged key material",
    async (at) => {
      expect(await verifyBackupStateSecrets(entries(), source, new Date(at))).toEqual(unavailable);
    },
  );
  it.each(["WAITRON_TILL_NODE_ID", "WAITRON_TILL_LOCATION_ID"])(
    "binds captured %s to the source",
    async (name) => {
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
    },
  );
  it("requires valid captured account-key encoding", async () => {
    expect(
      await verifyBackupStateSecrets(
        set(
          entries(),
          "trading.env",
          `WAITRON_TILL_NODE_ID=${source.nodeId}\nWAITRON_TILL_LOCATION_ID=${source.locationId}\nWAITRON_ACCOUNT_KEY=bad`,
        ),
        source,
        now,
      ),
    ).toEqual(unavailable);
  });
  it("accepts optional backup settings without accessing the old destination", async () => {
    const input = set(
      set(
        entries(),
        "backup.env",
        "WAITRON_BACKUP_DIR=/private-old-destination-sentinel\nWAITRON_BACKUP_RECOVERY_KEY=private-backup-key-sentinel\n",
      ),
      "modules.json",
      '{"modules":{"payments":false}}',
    );
    expect(await verifyBackupStateSecrets(input, source, now)).toEqual(pass);
    const dir = await place(input);
    expect(await readdir(dir)).not.toContain("backup.env");
    expect(await verifyBackupKeyPlacement(input, dir)).toBe("passed");
  });
  it.each([
    "WAITRON_BACKUP_RECOVERY_KEY=short\n",
    "WAITRON_BACKUP_DIR=/old\n",
    'WAITRON_BACKUP_DESTINATIONS={"secret":"private-destination-sentinel"}\n',
  ])("refuses malformed optional backup settings %#", async (value) => {
    expect(
      await verifyBackupStateSecrets(set(entries(), "backup.env", value), source, now),
    ).toEqual(unsupported);
  });
  it.each([
    "{",
    "null",
    '{"modules":{"unknown-module":true}}',
    '{"modules":{"payments":"off"}}',
    '{"modules":{"core":false}}',
    '{"modules":{},"extra":true}',
    '{"modules":{"payments":true,"payments":false}}',
  ])("refuses malformed or unknown module configuration %#", async (raw) => {
    expect(
      await verifyBackupStateSecrets(set(entries(), "modules.json", raw), source, now),
    ).toEqual(unsupported);
  });
  it.each(["cloud-connection.json", "cloud-staff.key", "cloud-staff.json", "cloud-staff.session"])(
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
  it("authenticates and checks the selected node's sealed state", async () => {
    expect(await verifyBackupStateSecrets(entries(), source, now, await seal(entries()))).toEqual(
      pass,
    );
  });
  it("a wrong key for selected-node state stays unavailable", async () => {
    const sealedState = await seal(entries());
    sealedState.recoveryKey = "wrong-private-key-sentinel";
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
      "WAITRON_TILL_NODE_ID=30000000-0000-4000-8000-000000000003\nWAITRON_TILL_LOCATION_ID=40000000-0000-4000-8000-000000000004\n",
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
        set(entries(), "tls/server.key", "private-malformed-sentinel"),
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
    expect(resolveAccountKey(env, loadKeyRing(env))).toEqual(Buffer.from(account, "base64"));
    expect(await verifyBackupKeyPlacement(input, dir)).toBe("passed");
  });
  it("accepts a redundant equal later-file key override", async () => {
    const input = set(
      entries(),
      "backup.env",
      `WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_ACCOUNT_KEY=${account}\n`,
    );
    expect(await verifyBackupKeyPlacement(input, await place(input))).toBe("passed");
  });
  it.each(["WAITRON_CREDENTIALS_KEY", "WAITRON_CREDENTIALS_KEY_VERSION", "WAITRON_ACCOUNT_KEY"])(
    "refuses a dropped later-file %s override",
    async (name) => {
      const value = name.endsWith("VERSION") ? "3" : otherKey;
      const input = set(entries(), "backup.env", `${name}=${value}\n`);
      const dir = await place(input);
      expect((await loadBoxEnv({}, dir))[name]).not.toBe(value);
      expect(await verifyBackupKeyPlacement(input, dir)).toBe("unsupported");
    },
  );
  it("refuses an account key present only in backup.env", async () => {
    const input = set(
      set(
        entries(),
        "trading.env",
        `WAITRON_TILL_NODE_ID=${source.nodeId}\nWAITRON_TILL_LOCATION_ID=${source.locationId}\n`,
      ),
      "backup.env",
      `WAITRON_ACCOUNT_KEY=${account}\n`,
    );
    const dir = await place(input);
    const env = await loadBoxEnv({}, dir);
    expect(resolveAccountKey(env, loadKeyRing(env))).not.toEqual(Buffer.from(account, "base64"));
    expect(await verifyBackupKeyPlacement(input, dir)).toBe("unsupported");
  });
  it("accepts the real derived account key when neither layout has an override", async () => {
    const input = set(
      entries(),
      "trading.env",
      `WAITRON_TILL_NODE_ID=${source.nodeId}\nWAITRON_TILL_LOCATION_ID=${source.locationId}\n`,
    );
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

it.each(['{"modules":null}', '{"modules":[]}', '{"modules":1}', "[]", "4", "{}"])(
  "refuses unsupported module envelope %#",
  async (raw) => {
    expect(
      await verifyBackupStateSecrets(set(entries(), "modules.json", raw), source, now),
    ).toEqual(unsupported);
  },
);
it("does not classify an unreadable sealed frame as a wrong key", async () => {
  expect(
    await verifyBackupStateSecrets(entries(), source, now, {
      sealed: Buffer.from("private-frame-sentinel"),
      recoveryKey: "private-key-sentinel",
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
      recoveryKey: "private-key-sentinel",
    }),
  ).toEqual(invalid);
});
it("missing captured key files cannot borrow keys from the placed layout", async () => {
  const dir = await place(entries());
  for (const name of ["secrets/secrets.env", "secrets/trading.env"]) {
    const captured = entries().filter((e) => e.name !== name);
    expect(await verifyBackupKeyPlacement(captured, dir)).toBe(
      name.endsWith("trading.env") ? "unsupported" : "unavailable",
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
it.each(["CA", "server"])("checks the %s validity independently", async (which) => {
  const expired = { ...validity, notAfter: new Date("2026-09-01T00:00:00.000Z") };
  const changed =
    which === "CA"
      ? certificate(issuer.cn, caKeys, issuer, "05", expired, [
          { name: "basicConstraints", cA: true },
        ])
      : certificate("verification.test", serverKeys, issuer, "06", expired, [
          { name: "basicConstraints", cA: false },
        ]);
  expect(
    await verifyBackupStateSecrets(
      set(entries(), which === "CA" ? "tls/ca.crt" : "tls/server.crt", pem(changed)),
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
      vi.spyOn(configReaders, "loadBackupConfig").mockImplementationOnce(() => {
        throw fault;
      });
    if (boundary === "decrypt")
      vi.spyOn(cipherReaders, "decryptArtifact").mockImplementationOnce(() => {
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
    { cn: "Different test CA", key: caKeys.privateKey },
    "07",
    validity,
    [{ name: "basicConstraints", cA: false }],
  );
  expect(new X509Certificate(pem(wrong)).verify(new X509Certificate(pem(ca)).publicKey)).toBe(true);
  expect(
    await verifyBackupStateSecrets(set(entries(), "tls/server.crt", pem(wrong)), source, now),
  ).toEqual(invalid);
});
it("accepts an equal derived account key redundantly supplied by backup.env", async () => {
  const input = set(
    entries(),
    "trading.env",
    `WAITRON_TILL_NODE_ID=${source.nodeId}\nWAITRON_TILL_LOCATION_ID=${source.locationId}\n`,
  );
  const dir = await place(input);
  const derived = resolveAccountKey(
    await loadBoxEnv({}, dir),
    loadKeyRing(await loadBoxEnv({}, dir)),
  );
  expect(
    await verifyBackupKeyPlacement(
      set(input, "backup.env", `WAITRON_ACCOUNT_KEY=${derived.toString("base64")}\n`),
      dir,
    ),
  ).toBe("passed");
});

it("an unexpected TLS reader fault is not reported as damaged key material", async () => {
  const fault = new Error("private-crypto-fault-sentinel");
  vi.spyOn(X509Certificate.prototype, "checkPrivateKey").mockImplementationOnce(() => {
    throw fault;
  });
  await expect(verifyBackupStateSecrets(entries(), source, now)).rejects.toBe(fault);
});
