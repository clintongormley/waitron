import { TextEncoder } from "node:util";
import { describe, expect, it } from "vitest";
import { WIFI_RECORD_MAX_BYTES, parseWifiRecord } from "./wifi-record.mjs";

const SSID = "4361666520436f726e6572"; // "Cafe Corner"
const SSID_32 = "ff".repeat(32);
const HEX_64 = "0123456789abcdef".repeat(4);

/** @param {Record<string, unknown>} [fields] */
const wifiFields = (fields = {}) => ({
  version: 1,
  ssidHex: SSID,
  keyMgmt: "wpa-psk",
  psk: "correct horse",
  hidden: false,
  ...fields,
});

/** The canonical form: the given keys in the given order, one final newline. @param {Record<string, unknown>} [fields] */
const recordBytes = (fields) => new TextEncoder().encode(JSON.stringify(wifiFields(fields)) + "\n");

/** @param {string} text */
const textBytes = (text) => new TextEncoder().encode(text);

/** @param {Uint8Array} bytes */
function expectLoaded(bytes) {
  const result = parseWifiRecord(bytes);
  expect(Object.isFrozen(result)).toBe(true);
  expect(result.kind).toBe("loaded");
  expect(Object.isFrozen(/** @type {any} */ (result).network)).toBe(true);
  return result;
}

/** @param {Record<string, unknown>} fields */
function expectLoadsAs(fields) {
  const { ssidHex, keyMgmt, psk, hidden } = wifiFields(fields);
  const network = { ssidHex, keyMgmt, psk, hidden };
  expect(expectLoaded(recordBytes(fields))).toEqual({ kind: "loaded", network });
}

/** @param {Uint8Array} bytes @param {string} reason */
function expectRefused(bytes, reason) {
  const result = parseWifiRecord(bytes);
  expect(result).toEqual({ kind: "refused", reason });
  expect(Object.isFrozen(result)).toBe(true);
}

describe("parseWifiRecord loads version 1", () => {
  it("WIFI_RECORD_MAX_BYTES is 1024", () => {
    expect(WIFI_RECORD_MAX_BYTES).toBe(1024);
  });

  it.each([
    ["a WPA2 record", {}],
    ["a WPA3 record with a non-ASCII password", { keyMgmt: "sae", psk: "contraseña Àngels" }],
    ["a 32-byte network name", { ssidHex: SSID_32 }],
    ["an 8-character password", { psk: "12345678" }],
    ["a 63-character password", { psk: "~ ".repeat(31) + "!" }],
    ["a 64-hex-digit password in lower case", { psk: HEX_64 }],
    ["a 64-hex-digit password in upper case", { psk: HEX_64.toUpperCase() }],
    ["a hidden network", { hidden: true }],
  ])("%s", (_name, fields) => {
    expectLoadsAs(fields);
  });

  it("the 63-character password really is 63 characters", () => {
    expect(("~ ".repeat(31) + "!").length).toBe(63);
  });

  it("the largest valid record — a 32-byte name and a 256-byte WPA3 password of '\"' characters, which JSON doubles — is under 1024 bytes and loads", () => {
    const fields = { ssidHex: SSID_32, keyMgmt: "sae", psk: '"'.repeat(256), hidden: false };
    const bytes = recordBytes(fields);
    expect(bytes.length).toBe(643);
    expect(bytes.length).toBeLessThan(WIFI_RECORD_MAX_BYTES);
    expectLoadsAs(fields);
  });
});

describe("parseWifiRecord refuses an oversized record", () => {
  /** @param {number} size */
  const padded = (size) => {
    const record = recordBytes();
    const bytes = new Uint8Array(size).fill(0x20);
    bytes.set(record);
    return bytes;
  };

  it("1025 bytes → record-oversized, even when they begin with a valid record", () => {
    expectRefused(padded(1025), "record-oversized");
  });

  it("1025 bytes of 0xFF → record-oversized, not corrupt", () => {
    expectRefused(new Uint8Array(1025).fill(0xff), "record-oversized");
  });

  it("a version 2 record padded to 1025 bytes → record-oversized, not unsupported", () => {
    const bytes = new Uint8Array(1025).fill(0x20);
    bytes.set(recordBytes({ version: 2 }));
    expectRefused(bytes, "record-oversized");
  });

  it("1024 bytes of the same shape → record-corrupt, not oversized", () => {
    expectRefused(padded(1024), "record-corrupt");
  });
});

describe("parseWifiRecord refuses a damaged record", () => {
  const canonical = JSON.stringify(wifiFields()) + "\n";

  /** @param {Record<string, unknown>} value */
  const rawRecord = (value) => textBytes(JSON.stringify(value) + "\n");

  /** A sae record whose password's middle byte is 0xFF. */
  const saeWithByteFF = () => {
    const bytes = recordBytes({ keyMgmt: "sae", psk: "abcXdef" });
    const at = bytes.indexOf("X".charCodeAt(0));
    bytes[at] = 0xff;
    return bytes;
  };

  /** @type {Array<[string, () => Uint8Array]>} */
  const cases = [
    ["invalid JSON", () => textBytes('{"version":1,\n')],
    ["a JSON array", () => textBytes("[1]\n")],
    ["JSON null", () => textBytes("null\n")],
    ["extra spaces", () => textBytes(JSON.stringify(wifiFields(), null, 1) + "\n")],
    [
      "keys in another order",
      () => {
        const { version, ...rest } = wifiFields();
        return rawRecord({ ...rest, version });
      },
    ],
    ["no final newline", () => textBytes(canonical.slice(0, -1))],
    ["an extra key", () => recordBytes({ band: "5GHz" })],
    [
      "a missing key",
      () => {
        const { version, ssidHex, keyMgmt, psk } = wifiFields();
        return rawRecord({ version, ssidHex, keyMgmt, psk });
      },
    ],
    ["ssidHex of odd length", () => recordBytes({ ssidHex: "abc" })],
    ["ssidHex in upper case", () => recordBytes({ ssidHex: SSID.toUpperCase() })],
    ["ssidHex empty", () => recordBytes({ ssidHex: "" })],
    ["ssidHex of 33 bytes", () => recordBytes({ ssidHex: "ab".repeat(33) })],
    ["ssidHex not a string", () => recordBytes({ ssidHex: 7 })],
    ['ssidHex an array, ["ab"]', () => recordBytes({ ssidHex: ["ab"] })],
    ["a WPA2 password of 7 characters", () => recordBytes({ psk: "1234567" })],
    ["a WPA2 password of 64 non-hex characters", () => recordBytes({ psk: "g".repeat(64) })],
    ["a WPA2 password of 65 characters", () => recordBytes({ psk: "a".repeat(65) })],
    ["a WPA2 password not a string", () => recordBytes({ psk: 12345678 })],
    [
      "a WPA2 password of 4 emoji (8 UTF-16 units, 4 characters)",
      () => recordBytes({ psk: "😀".repeat(4) }),
    ],
    ["a WPA3 password empty", () => recordBytes({ keyMgmt: "sae", psk: "" })],
    ["a WPA3 password of 257 bytes", () => recordBytes({ keyMgmt: "sae", psk: "a".repeat(257) })],
    [
      "a WPA3 password of 257 bytes made of 2-byte characters",
      () => recordBytes({ keyMgmt: "sae", psk: "a" + "ñ".repeat(128) }),
    ],
    ["a WPA3 password holding U+0000", () => recordBytes({ keyMgmt: "sae", psk: "abc\u0000def" })],
    ["a WPA3 password holding U+001F", () => recordBytes({ keyMgmt: "sae", psk: "abc\u001fdef" })],
    ["a WPA3 password holding U+007F", () => recordBytes({ keyMgmt: "sae", psk: "abc\u007fdef" })],
    ['a WPA3 password written as "\\ud800"', () => recordBytes({ keyMgmt: "sae", psk: "\ud800" })],
    ["a WPA3 password not a string", () => recordBytes({ keyMgmt: "sae", psk: null })],
    ['hidden: "false"', () => recordBytes({ hidden: "false" })],
    ["a 0xFF byte inside a sae record's password", saeWithByteFF],
    ["a byte-order mark before the record", () => textBytes("\ufeff" + canonical)],
    ['version: "1"', () => recordBytes({ version: "1" })],
    ["version: 1.5", () => recordBytes({ version: 1.5 })],
    ["keyMgmt: 7", () => recordBytes({ keyMgmt: 7 })],
  ];

  it.each(cases)("%s → record-corrupt", (_name, bytes) => {
    expectRefused(bytes(), "record-corrupt");
  });

  it("the sae 257-byte cases really are 257 bytes", () => {
    expect(textBytes("a".repeat(257)).length).toBe(257);
    expect(textBytes("a" + "ñ".repeat(128)).length).toBe(257);
  });

  it("the 256-byte WPA3 password of 2-byte characters loads", () => {
    expectLoadsAs({ keyMgmt: "sae", psk: "ñ".repeat(128) });
  });

  it("the 0xFF case changes one byte of a sae record that loads", () => {
    expectLoadsAs({ keyMgmt: "sae", psk: "abcXdef" });
    expect(saeWithByteFF().length).toBe(recordBytes({ keyMgmt: "sae", psk: "abcXdef" }).length);
  });
});

describe("parseWifiRecord refuses a record it does not support", () => {
  /** @type {Array<[string, () => Uint8Array]>} */
  const cases = [
    ["a WPA2 password holding a tab", () => recordBytes({ psk: "pass\tword" })],
    ["a WPA2 password holding ñ", () => recordBytes({ psk: "contraseña" })],
    [
      "a WPA2 password of 32 emoji (64 UTF-16 units, 32 characters)",
      () => recordBytes({ psk: "😀".repeat(32) }),
    ],
    ["version: 2 with otherwise valid fields", () => recordBytes({ version: 2 })],
    ["version: 2 with extra keys", () => recordBytes({ version: 2, band: "5GHz", extra: true })],
    ["version: 0", () => recordBytes({ version: 0 })],
    ['keyMgmt "none"', () => recordBytes({ keyMgmt: "none" })],
    ['keyMgmt "wpa-eap"', () => recordBytes({ keyMgmt: "wpa-eap" })],
    ['keyMgmt "owe"', () => recordBytes({ keyMgmt: "owe" })],
    ['keyMgmt "WPA-PSK"', () => recordBytes({ keyMgmt: "WPA-PSK" })],
  ];

  it.each(cases)("%s → record-unsupported", (_name, bytes) => {
    expectRefused(bytes(), "record-unsupported");
  });
});

describe("parseWifiRecord refuses input that is not bytes", () => {
  it.each([
    ["a string", JSON.stringify(wifiFields()) + "\n"],
    ["an Array", Array.from(recordBytes())],
    ["null", null],
  ])("%s → throws wifi_record.input_invalid", (_name, value) => {
    expect(() => parseWifiRecord(/** @type {any} */ (value))).toThrow(
      expect.objectContaining({ code: "wifi_record.input_invalid", reason: "input-invalid" }),
    );
  });
});
