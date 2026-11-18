import { describe, expect, it } from "vitest";
import { hasCode } from "@waitron/shared";
import {
  KEY_RING_VARIABLES,
  keyForVersion,
  loadKeyRing,
  singleLineKeyRingVariables,
} from "./keyring.js";
import * as keyRingFormat from "./keyring.js";
import { capturedSync as captured } from "./testing/captured.js";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");

describe("loadKeyRing", () => {
  it("reads the current key and defaults its version to 1", () => {
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1 });
    expect(ring.current.version).toBe(1);
    expect(ring.current.key.equals(Buffer.alloc(32, 1))).toBe(true);
    expect(ring.previous).toBeUndefined();
  });

  it("reads an explicit current version", () => {
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "7" });
    expect(ring.current.version).toBe(7);
  });

  it("reads a previous key alongside the current one", () => {
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    expect(ring.previous?.version).toBe(1);
    expect(ring.previous?.key.equals(Buffer.alloc(32, 1))).toBe(true);
  });

  it("rejects a missing current key", () => {
    const error = captured(() => loadKeyRing({}));
    expect(hasCode(error, "credentials.key_missing")).toBe(true);
  });

  it("rejects an empty current key", () => {
    const error = captured(() => loadKeyRing({ WAITRON_CREDENTIALS_KEY: "" }));
    expect(hasCode(error, "credentials.key_missing")).toBe(true);
  });

  it("rejects a key that is not 32 bytes", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(16, 1).toString("base64") }),
    );
    expect(hasCode(error, "credentials.key_invalid")).toBe(true);
  });

  it("rejects a previous key with no version", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K2, WAITRON_CREDENTIALS_KEY_PREVIOUS: K1 }),
    );
    expect(hasCode(error, "credentials.key_ring_incomplete")).toBe(true);
    // Not just the code: the ternary in loadKeyRing picks `supplied`/`missing` by which of the two
    // env vars is undefined, and an arm-swap there — an easy, operator-facing bug — would leave a
    // bare hasCode check green. Here PREVIOUS was supplied and PREVIOUS_VERSION was not.
    expect(error.params).toEqual({
      supplied: "WAITRON_CREDENTIALS_KEY_PREVIOUS",
      missing: "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION",
    });
  });

  it("rejects a previous version with no key — the other half of both-or-neither", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K2, WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1" }),
    );
    expect(hasCode(error, "credentials.key_ring_incomplete")).toBe(true);
    // The other ternary arm: PREVIOUS_VERSION was supplied and PREVIOUS was not.
    expect(error.params).toEqual({
      supplied: "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION",
      missing: "WAITRON_CREDENTIALS_KEY_PREVIOUS",
    });
  });

  it("rejects a previous key with an explicit but empty version", () => {
    // Distinct from "no version" above: PREVIOUS_VERSION is PRESENT (not undefined) but blank, so
    // the both-or-neither gate in loadKeyRing lets it through, and readVersion's own required-value
    // branch (no fallback for the previous key) must catch it instead.
    const error = captured(() =>
      loadKeyRing({
        WAITRON_CREDENTIALS_KEY: K2,
        WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "",
      }),
    );
    expect(hasCode(error, "credentials.key_version_invalid")).toBe(true);
    expect(error.params).toEqual({
      variable: "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION",
      reason: "empty",
    });
  });

  it("rejects a non-integer version", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1.5" }),
    );
    expect(hasCode(error, "credentials.key_version_invalid")).toBe(true);
    expect(error.params).toEqual({
      variable: "WAITRON_CREDENTIALS_KEY_VERSION",
      reason: "not-an-integer",
    });
  });

  it("rejects a version below 1, matching the column's own CHECK", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "0" }),
    );
    expect(hasCode(error, "credentials.key_version_invalid")).toBe(true);
    expect(error.params).toEqual({
      variable: "WAITRON_CREDENTIALS_KEY_VERSION",
      reason: "below-1",
    });
  });

  it("never echoes the offending value for an invalid current version", () => {
    // An operator transposes WAITRON_CREDENTIALS_KEY_VERSION and WAITRON_CREDENTIALS_KEY (a
    // plausible .env/systemd typo), handing this function real key material where a small integer
    // was expected. The params may not carry `leaked`, because bin.ts prints an AppError's params
    // verbatim to stderr, and that reaches scrollback and log capture.
    const leaked = Buffer.alloc(32, 7).toString("base64");
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: leaked }),
    );
    expect(hasCode(error, "credentials.key_version_invalid")).toBe(true);
    expect(JSON.stringify(error.params)).not.toContain(leaked);
  });

  it("never echoes the offending value for an invalid previous version", () => {
    const leaked = Buffer.alloc(32, 8).toString("base64");
    const error = captured(() =>
      loadKeyRing({
        WAITRON_CREDENTIALS_KEY: K1,
        WAITRON_CREDENTIALS_KEY_PREVIOUS: K2,
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: leaked,
      }),
    );
    expect(hasCode(error, "credentials.key_version_invalid")).toBe(true);
    expect(JSON.stringify(error.params)).not.toContain(leaked);
  });

  it("refuses a ring whose two members share a version", () => {
    // `keyForVersion` checks `current` before `previous`, so a collision would shadow `previous`'s
    // key for that version for the life of the ring, and `rotateCredentials` would treat every row
    // on the shared version as already current, re-sealing NOTHING while reporting the vault clean.
    // A dedicated code, not `key_ring_incomplete`: both variables WERE supplied here.
    const error = captured(() =>
      loadKeyRing({
        WAITRON_CREDENTIALS_KEY: K2,
        WAITRON_CREDENTIALS_KEY_VERSION: "3",
        WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "3",
      }),
    );
    expect(hasCode(error, "credentials.key_ring_version_collision")).toBe(true);
    expect(error.params).toEqual({
      version: 3,
      currentVariable: "WAITRON_CREDENTIALS_KEY_VERSION",
      previousVariable: "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION",
    });
  });
});

describe("KEY_RING_VARIABLES", () => {
  const full = {
    WAITRON_CREDENTIALS_KEY: K1,
    WAITRON_CREDENTIALS_KEY_VERSION: "3",
    WAITRON_CREDENTIALS_KEY_PREVIOUS: K2,
    WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "2",
  };

  it("names every variable a full ring is read from, and nothing else", () => {
    const listed = Object.fromEntries(KEY_RING_VARIABLES.map((name) => [name, full[name]]));
    expect(loadKeyRing({ ...listed, UNLISTED: "x" })).toEqual(loadKeyRing(full));
    expect(Object.keys(listed).sort()).toEqual(Object.keys(full).sort());
  });

  it.each(KEY_RING_VARIABLES.map((name) => [name]))("%s changes what loadKeyRing reads", (name) => {
    const without: Record<string, string> = { ...full };
    delete without[name];
    let read: unknown;
    try {
      read = loadKeyRing(without);
    } catch (error) {
      read = error;
    }
    expect(read).not.toEqual(loadKeyRing(full));
  });
});

describe("singleLineKeyRingVariables", () => {
  function outcome(env: Record<string, string>) {
    try {
      return loadKeyRing(env);
    } catch (error) {
      return error;
    }
  }

  it.each([
    [
      "line breaks and spaces in a key",
      { WAITRON_CREDENTIALS_KEY: `${K1.slice(0, 9)}\n ${K1.slice(9)}\n` },
    ],
    [
      "a key in the URL-safe alphabet",
      { WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 251).toString("base64url") },
    ],
    [
      "versions with line breaks around them",
      {
        WAITRON_CREDENTIALS_KEY: K1,
        WAITRON_CREDENTIALS_KEY_VERSION: "\n4\n",
        WAITRON_CREDENTIALS_KEY_PREVIOUS: K2,
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: " 03\t",
      },
    ],
    ["an empty version", { WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "" }],
    [
      "a version of spaces only",
      { WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: " \n" },
    ],
    [
      "a version that is no number",
      { WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1\n2" },
    ],
    [
      "a key that is not 32 bytes",
      { WAITRON_CREDENTIALS_KEY: Buffer.alloc(31, 1).toString("base64") },
    ],
  ])("writes %s on one line, read as the original is", (_case, env) => {
    const written: Record<string, string> = singleLineKeyRingVariables(env);
    for (const value of Object.values(written)) expect(value).toBe(value.trim().replace(/\s/g, ""));
    expect(outcome(written)).toEqual(outcome(env));
  });

  it("leaves a value that is already on one line as it is, and another variable alone", () => {
    const env = {
      WAITRON_CREDENTIALS_KEY: K1,
      WAITRON_CREDENTIALS_KEY_VERSION: "4",
      OTHER: " x\n",
    };
    expect(singleLineKeyRingVariables(env)).toEqual(env);
  });
});

describe("keyForVersion", () => {
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: K2,
    WAITRON_CREDENTIALS_KEY_VERSION: "2",
    WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
    WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
  });

  it("selects the current key by its version", () => {
    expect(keyForVersion(ring, 2)?.equals(Buffer.alloc(32, 2))).toBe(true);
  });

  it("selects the previous key by its version — the interrupted-rotate case", () => {
    expect(keyForVersion(ring, 1)?.equals(Buffer.alloc(32, 1))).toBe(true);
  });

  it("returns null for a version the ring does not carry", () => {
    expect(keyForVersion(ring, 99)).toBeNull();
  });
});

describe("key ring format", () => {
  it("encodes current and previous keys without changing their bytes", () => {
    expect(keyRingFormat).toHaveProperty("encodeKeyRing");
    const current = { key: Buffer.alloc(32, 2), version: 7 };
    expect(
      keyRingFormat.encodeKeyRing({ current, previous: { key: Buffer.alloc(32, 1), version: 6 } }),
    ).toEqual({
      key: K2,
      version: 7,
      previous: { key: K1, version: 6 },
    });
    expect(keyRingFormat.encodeKeyRing({ current })).toEqual({ key: K2, version: 7 });
  });

  it("maps variables without normalising spelling", () => {
    expect(keyRingFormat).toHaveProperty("keyRingEnv");
    const key = K2.slice(0, -1) + "\n";
    const previous = { key: K1.slice(0, -1), version: 6 };
    expect(keyRingFormat.keyRingEnv({ key, version: 7, previous })).toEqual({
      WAITRON_CREDENTIALS_KEY: key,
      WAITRON_CREDENTIALS_KEY_VERSION: "7",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: previous.key,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "6",
    });
    expect(keyRingFormat.keyRingEnv({ key, version: 7 })).toEqual({
      WAITRON_CREDENTIALS_KEY: key,
      WAITRON_CREDENTIALS_KEY_VERSION: "7",
    });
    expect(loadKeyRing(keyRingFormat.keyRingEnv({ key, version: 7 })).current.key).toEqual(
      Buffer.alloc(32, 2),
    );
  });
});
