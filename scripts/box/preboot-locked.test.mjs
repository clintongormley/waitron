import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOX_NAME, freezeLockedTarget } from "./preboot-locked.mjs";

const RECOVERY_SAN = "DNS:unlock-a1b2.waitron.local";
const LONG_ID = "a".repeat(56);

// Every key is made first, so a certificate that must share a key names it rather than
// depending on which command wrote it.
const FIXTURES = String.raw`set -eu
serial=1
eckey() { openssl ecparam -name prime256v1 -genkey -noout -out "$1.key"; }
self() {
  name=$1; key=$2; days=$3; subject=$4; shift 4
  openssl req -x509 -new -key "$key.key" -days "$days" -subj "$subject" -out "$name.pem" "$@"
}
signed() {
  name=$1; key=$2; issuer=$3; days=$4; extensions=$5
  serial=$((serial + 1))
  openssl req -new -key "$key.key" -subj "/CN=$name" -out "$name.csr"
  printf '%b' "$extensions" > "$name.ext"
  openssl x509 -req -in "$name.csr" -CA "$issuer.pem" -CAkey "$issuer.key" \
    -set_serial "$serial" -days "$days" -extfile "$name.ext" -out "$name.pem"
}
for k in ca impostorCa recovery redirect; do eckey "$k"; done
openssl genrsa -out rsaCa.key 2048
openssl genrsa -out rsaRecovery.key 2048

CA_EXT="-addext basicConstraints=critical,CA:TRUE"
# The impostor copies the CA's key identifier as well as its name. OpenSSL 3.5.7 stamped leaves
# with their issuer's identifier and checkIssued compares it, so without the copy the impostor's
# leaf was refused before the signature check was reached.
SAME_ID="-addext subjectKeyIdentifier=5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a"
self ca ca 30 "/CN=Waitron box CA" $CA_EXT $SAME_ID -addext "nameConstraints=critical,permitted;DNS:waitron.local"
self impostorCa impostorCa 30 "/CN=Waitron box CA" $CA_EXT $SAME_ID
self rsaCa rsaCa 30 "/CN=Waitron box CA" $CA_EXT -addext "nameConstraints=critical,permitted;DNS:waitron.local"

LEAF='basicConstraints=CA:FALSE\nsubjectAltName='
signed recovery recovery ca 7 "$LEAF$RECOVERY_SAN"
signed normal recovery ca 7 "$LEAF""DNS:waitron.local,IP:192.168.1.5"
signed withBoxName recovery ca 7 "$LEAF$RECOVERY_SAN,DNS:waitron.local"
signed withAddress recovery ca 7 "$LEAF$RECOVERY_SAN,IP:192.168.1.5"
signed otherId recovery ca 7 "$LEAF""DNS:unlock-zz99.waitron.local"
signed longId recovery ca 7 "$LEAF""DNS:unlock-$LONG_ID.waitron.local"
signed longLived recovery ca 60 "$LEAF$RECOVERY_SAN"
signed leafAsCa recovery ca 7 "basicConstraints=critical,CA:TRUE\nsubjectAltName=$RECOVERY_SAN"
signed impostorRecovery recovery impostorCa 7 "$LEAF$RECOVERY_SAN"
signed recoverySameKey ca ca 7 "$LEAF$RECOVERY_SAN"
signed redirectByImpostor redirect impostorCa 7 "$LEAF""DNS:waitron.local"
signed rsaRecovery rsaRecovery rsaCa 7 "$LEAF$RECOVERY_SAN"

NOT_CA="-addext basicConstraints=critical,CA:FALSE"
self redirect redirect 30 "/CN=waitron.local" $NOT_CA -addext subjectAltName=DNS:waitron.local
self redirectAsCa redirect 30 "/CN=waitron.local" $CA_EXT -addext subjectAltName=DNS:waitron.local
self redirectShort redirect 1 "/CN=waitron.local" $NOT_CA -addext subjectAltName=DNS:waitron.local
self redirectWrongName redirect 30 "/CN=example.test" $NOT_CA -addext subjectAltName=DNS:example.test
self redirectSameKey recovery 30 "/CN=waitron.local" $NOT_CA -addext subjectAltName=DNS:waitron.local
`;

/** @type {Record<string, string>} */
const pem = {};
/** @type {string} */
let folder;

beforeAll(async () => {
  folder = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "preboot-locked-")));
  const script = join(folder, "fixtures.sh");
  await fs.writeFile(script, FIXTURES);
  execFileSync("sh", [script], {
    cwd: folder,
    timeout: 20_000,
    stdio: "pipe",
    env: { ...process.env, RECOVERY_SAN, LONG_ID },
  });
  for (const name of await fs.readdir(folder)) {
    if (name.endsWith(".pem") || name.endsWith(".key")) {
      pem[name] = await fs.readFile(join(folder, name), "utf8");
    }
  }
}, 30_000);

afterAll(async () => {
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});

/** @param {string} name */
const cert = (name) => pem[`${name}.pem`];
/** @param {string} name */
const from = (name) => new X509Certificate(cert(name)).validFromDate.getTime();
/** @param {string} name */
const to = (name) => new X509Certificate(cert(name)).validToDate.getTime();

/** @param {Partial<Record<string, unknown>>} [overrides] */
function input(overrides = {}) {
  return {
    installationId: "a1b2",
    caCertificate: cert("ca"),
    recoveryCertificate: cert("recovery"),
    redirectCertificate: cert("redirect"),
    now: from("recovery") + 1000,
    ...overrides,
  };
}

const READY = {
  kind: "ready",
  target: {
    recoveryHost: "unlock-a1b2.waitron.local",
    recoveryUrl: "https://unlock-a1b2.waitron.local/",
    redirect: "ready",
    redirectRefusal: null,
  },
};

/** @param {string} redirectRefusal */
const redirectRefused = (redirectRefusal) => ({
  kind: "ready",
  target: { ...READY.target, redirect: "refused", redirectRefusal },
});

/** @param {string} reason */
const refused = (reason) => ({ kind: "refused", reason });

/** @param {string} text */
const crlf = (text) => text.replace(/\n/g, "\r\n");

describe("freezeLockedTarget", () => {
  it("names the box waitron.local", () => {
    expect(BOX_NAME).toBe("waitron.local");
  });

  it("the valid set → ready, frozen", () => {
    const result = freezeLockedTarget(input());
    expect(result).toEqual(READY);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(/** @type {any} */ (result).target)).toBe(true);
  });

  describe("installation id", () => {
    it("a 56-character id → ready, and its recovery label is 63 characters", () => {
      expect(`unlock-${LONG_ID}`).toHaveLength(63);
      expect(
        freezeLockedTarget(input({ installationId: LONG_ID, recoveryCertificate: cert("longId") })),
      ).toEqual({
        kind: "ready",
        target: {
          ...READY.target,
          recoveryHost: `unlock-${LONG_ID}.waitron.local`,
          recoveryUrl: `https://unlock-${LONG_ID}.waitron.local/`,
        },
      });
    });

    it.each(["", "a".repeat(57), "A1B2", "a-b2", "a.b2"])("%j → installation-id-invalid", (id) => {
      expect(freezeLockedTarget(input({ installationId: id }))).toEqual(
        refused("installation-id-invalid"),
      );
    });
  });

  describe("one certificate block per input", () => {
    it("recovery PEM with the CA's private key appended → certificate-unreadable, and no key text in the result", () => {
      const result = freezeLockedTarget(
        input({ recoveryCertificate: cert("recovery") + pem["ca.key"] }),
      );
      expect(result).toEqual(refused("certificate-unreadable"));
      expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    });

    it.each([
      ["two certificates concatenated", () => cert("recovery") + cert("normal")],
      ["a private key alone", () => pem["recovery.key"]],
      ["garbage", () => "garbage"],
      [
        "a well-formed block that is not a certificate",
        () => "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
      ],
      ["a second final line ending", () => `${cert("recovery")}\n`],
    ])("%s as the recovery certificate → certificate-unreadable", (_name, value) => {
      expect(freezeLockedTarget(input({ recoveryCertificate: value() }))).toEqual(
        refused("certificate-unreadable"),
      );
    });

    it("garbage as the CA certificate → certificate-unreadable", () => {
      expect(freezeLockedTarget(input({ caCertificate: "garbage" }))).toEqual(
        refused("certificate-unreadable"),
      );
    });

    it("a block with no final line ending is accepted", () => {
      expect(
        freezeLockedTarget(input({ recoveryCertificate: cert("recovery").trimEnd() })),
      ).toEqual(READY);
    });
  });

  describe("the real box CA's shape: RSA-2048", () => {
    const rsa = (/** @type {(text: string) => string} */ shape) =>
      input({
        caCertificate: shape(cert("rsaCa")),
        recoveryCertificate: shape(cert("rsaRecovery")),
        now: from("rsaRecovery") + 1000,
      });

    it("rsaCa and rsaRecovery, both with \\r\\n line endings → ready", () => {
      expect(cert("rsaCa")).not.toContain("\r");
      expect(freezeLockedTarget(rsa(crlf))).toEqual(READY);
    });

    it("the same with \\n → ready", () => {
      expect(freezeLockedTarget(rsa((text) => text))).toEqual(READY);
    });

    it("rsaRecovery with one line ending changed to \\n among \\r\\n → certificate-unreadable", () => {
      const mixed = crlf(cert("rsaRecovery")).replace("\r\n", "\n");
      expect(mixed.split("\r\n").length).toBeGreaterThan(3);
      expect(
        freezeLockedTarget(
          input({
            caCertificate: crlf(cert("rsaCa")),
            recoveryCertificate: mixed,
            now: from("rsaRecovery") + 1000,
          }),
        ),
      ).toEqual(refused("certificate-unreadable"));
    });

    it("a lone \\r inside a \\n block → certificate-unreadable", () => {
      const stray = cert("recovery").replace("\n", "\r");
      expect(freezeLockedTarget(input({ recoveryCertificate: stray }))).toEqual(
        refused("certificate-unreadable"),
      );
    });
  });

  describe("the CA certificate", () => {
    it("the recovery certificate passed as the CA → ca-invalid", () => {
      expect(freezeLockedTarget(input({ caCertificate: cert("recovery") }))).toEqual(
        refused("ca-invalid"),
      );
    });

    it("a CA certificate another key signed (leafAsCa) passed as the CA → ca-invalid", () => {
      expect(freezeLockedTarget(input({ caCertificate: cert("leafAsCa") }))).toEqual(
        refused("ca-invalid"),
      );
    });
  });

  describe("the recovery certificate", () => {
    it("impostorRecovery (issuer name matches, another key signed it) → recovery-not-ca-signed", () => {
      const impostor = new X509Certificate(cert("impostorRecovery"));
      expect(impostor.checkIssued(new X509Certificate(cert("ca")))).toBe(true);
      expect(freezeLockedTarget(input({ recoveryCertificate: cert("impostorRecovery") }))).toEqual(
        refused("recovery-not-ca-signed"),
      );
    });

    it("a certificate whose issuer is not the CA's name → recovery-not-ca-signed", () => {
      expect(freezeLockedTarget(input({ recoveryCertificate: cert("redirect") }))).toEqual(
        refused("recovery-not-ca-signed"),
      );
    });

    it("leafAsCa → recovery-is-ca", () => {
      expect(freezeLockedTarget(input({ recoveryCertificate: cert("leafAsCa") }))).toEqual(
        refused("recovery-is-ca"),
      );
    });

    it("recoverySameKey → recovery-same-key", () => {
      expect(freezeLockedTarget(input({ recoveryCertificate: cert("recoverySameKey") }))).toEqual(
        refused("recovery-same-key"),
      );
    });

    it.each(["withBoxName", "withAddress", "otherId", "normal"])(
      "%s as the recovery certificate → recovery-names-wrong",
      (name) => {
        expect(freezeLockedTarget(input({ recoveryCertificate: cert(name) }))).toEqual(
          refused("recovery-names-wrong"),
        );
      },
    );

    it("now one second before validFrom → recovery-expired", () => {
      expect(freezeLockedTarget(input({ now: from("recovery") - 1000 }))).toEqual(
        refused("recovery-expired"),
      );
    });

    it("now one second after validTo → recovery-expired", () => {
      expect(freezeLockedTarget(input({ now: to("recovery") + 1000 }))).toEqual(
        refused("recovery-expired"),
      );
    });

    it("longLived → recovery-outlives-ca", () => {
      expect(to("longLived")).toBeGreaterThan(to("ca"));
      expect(freezeLockedTarget(input({ recoveryCertificate: cert("longLived") }))).toEqual(
        refused("recovery-outlives-ca"),
      );
    });
  });

  describe("the redirect certificate", () => {
    it.each(["normal", "recovery", "ca"])(
      "%s as the redirect certificate → redirect-ca-signed",
      (name) => {
        expect(freezeLockedTarget(input({ redirectCertificate: cert(name) }))).toEqual(
          redirectRefused("redirect-ca-signed"),
        );
      },
    );

    it.each([
      ["redirectByImpostor", "redirect-not-self-signed"],
      ["redirectAsCa", "redirect-is-ca"],
      ["redirectWrongName", "redirect-names-wrong"],
      ["redirectSameKey", "redirect-same-key"],
    ])("%s → %s", (name, reason) => {
      expect(freezeLockedTarget(input({ redirectCertificate: cert(name) }))).toEqual(
        redirectRefused(reason),
      );
    });

    it('"garbage" → certificate-unreadable', () => {
      expect(freezeLockedTarget(input({ redirectCertificate: "garbage" }))).toEqual(
        redirectRefused("certificate-unreadable"),
      );
    });

    it("an expired redirect certificate is still ready: its dates are not checked", () => {
      const now = to("redirectShort") + 1000;
      expect(now).toBeLessThan(to("recovery"));
      expect(
        freezeLockedTarget(input({ redirectCertificate: cert("redirectShort"), now })),
      ).toEqual(READY);
    });
  });

  describe("caller errors throw", () => {
    const keys = [
      "installationId",
      "caCertificate",
      "recoveryCertificate",
      "redirectCertificate",
      "now",
    ];
    /** @param {Record<string, unknown>} value @param {string} key */
    const withoutKey = (value, key) => {
      const copy = { ...value };
      delete copy[key];
      return copy;
    };

    it.each([
      ["null", () => null],
      ["an array", () => []],
      ...keys.map((key) => [`missing ${key}`, () => withoutKey(input(), key)]),
      ["an extra key", () => ({ ...input(), privateKey: "x" })],
      ["a non-string installation id", () => input({ installationId: 12 })],
      ["a non-string CA certificate", () => input({ caCertificate: new Uint8Array(1) })],
      ["a non-string recovery certificate", () => input({ recoveryCertificate: null })],
      ["a non-string redirect certificate", () => input({ redirectCertificate: 1 })],
      ["now NaN", () => input({ now: Number.NaN })],
      ["now Infinity", () => input({ now: Infinity })],
      ["now a string", () => input({ now: "1" })],
    ])("%s → recovery_identity.input_invalid", (_name, value) => {
      expect(() => freezeLockedTarget(value())).toThrow(
        expect.objectContaining({
          code: "recovery_identity.input_invalid",
          reason: "input-invalid",
        }),
      );
    });
  });
});
