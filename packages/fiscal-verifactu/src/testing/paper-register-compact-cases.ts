import { describe, expect, it } from "vitest";
import * as api from "../paper-register-compact.js";
import additionalVectors from "./paper-register-node-vectors.json";
import type {
  PrintedNodeFields,
  PrintedPositionFields,
  RegisterScope,
} from "../paper-register-protocol.js";

const scope = { environment: "production", softwareId: "W1", taxpayerNif: "89890001K" } as const;
const nodeId = "11111111-1111-4111-8111-111111111111";
const name = "2026-10-15 · DEMO";
const position = { sHighWater: 42, pHighWater: 7 };
const fields = { sPosition: "0000 42", pPosition: "0000 07", check: "DFZJ DGAN" };
const raw = {
  encoding: "raw192" as const,
  secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX",
  value: "000G 40R4 0M30 E209 185G R38E 1W81 24GK 2GAH C5R",
  check: "BTBY 78WP",
};
const vectors = [
  raw,
  {
    encoding: "utf8" as const,
    secret: "  ClAvE-λ_\t\n",
    value: "40G4 6V21 ES2J VKNV BW4G M",
    check: "73QD 8ETS",
  },
  {
    encoding: "utf8" as const,
    secret: "abcdefghijklmnopqrstuvwx",
    value: "C5H6 6S35 CSKP GTBA DDP6 TVKF E1RQ 4WVM ENV7 EY0",
    check: "SA05 03Z8",
  },
  {
    encoding: "utf8" as const,
    secret: "\ufeffKey",
    value: "XYXV YJV5 F4",
    check: "EG3S NXNG",
  },
];
const refused = "Paper register value refused";

export function describePaperRegisterCompact() {
  describe("unsigned printed register and named node keys", () => {
    it("continues the printed register through the explicit browser-safe package exports", async () => {
      const exported = await import("@waitron/fiscal-verifactu/paper-register-compact");
      expect(await exported.decodePosition(fields, scope)).toEqual(position);
    });
    it("encodes fixed decimal floors with the v2 scope check and four-character groups", async () => {
      expect(await api.encodePosition(scope, position)).toEqual({
        fields,
        enteredCharacters: 20,
        displayedCharacters: 23,
      });
      expect(await api.decodePosition(fields, scope)).toEqual(position);
    });

    it("accepts lowercase, ambiguous aliases and only the permitted ASCII separators", async () => {
      expect(api.normaliseTypedCode("o-i L\taz\r\n9")).toBe("011AZ9");
      expect(
        await api.decodePosition(
          { sPosition: "o-o o\tO4\r\n2", pPosition: "000-007", check: "dfzj-dgan" },
          scope,
        ),
      ).toEqual(position);
      const changed = {
        encoding: raw.encoding,
        value: raw.value
          .toLowerCase()
          .replaceAll("0", "o")
          .replaceAll("1", "l")
          .replaceAll(" ", "-\t\n"),
        check: "btby-78wp",
      };
      expect(await api.decodeNodeKey(changed, scope, nodeId, name)).toBe(raw.secret);
    });

    it.each(["\u00a0", "\v", "\f", "\u2009", "\u2010", "ſ", "ı", "U", "=", "!"])(
      "refuses unsupported typed character %j",
      (bad) => {
        expect(() => api.normaliseTypedCode("0" + bad)).toThrow(refused);
      },
    );

    it.each([
      { sPosition: "00000A" },
      { sPosition: "00000" },
      { pPosition: "0000007" },
      { check: "DFZJDGAM" },
      { check: "DFZJDGANN" },
      { check: "DFZJ\u00a0DGAN" },
      { extra: true },
    ])("refuses malformed or edited printed position fields %#", async (patch) => {
      await expect(api.decodePosition({ ...fields, ...patch }, scope)).rejects.toThrow(refused);
    });

    it.each([
      { taxpayerNif: "89890002K" },
      { softwareId: "W2" },
      { environment: "preproduction" },
      { taxpayerNif: "89890001k" },
      { softwareId: "W11" },
      { environment: "test" },
      { extra: true },
    ])("refuses scope substitution or malformed scope %#", async (patch) => {
      await expect(
        api.decodePosition(fields, { ...scope, ...patch } as RegisterScope),
      ).rejects.toThrow(refused);
    });

    it.each([-1, 1.1, 1000000, NaN, Infinity])(
      "refuses position outside whole six-digit floors %s",
      async (bad) => {
        await expect(api.encodePosition(scope, { ...position, sHighWater: bad })).rejects.toThrow(
          refused,
        );
        await expect(api.encodePosition(scope, { ...position, pHighWater: bad })).rejects.toThrow(
          refused,
        );
      },
    );

    it.each([0, 999999])("round trips the valid floor boundary %s", async (n) => {
      const original = { sHighWater: n, pHighWater: n };
      const printed = await api.encodePosition(scope, original);
      expect(await api.decodePosition(printed.fields, scope)).toEqual(original);
    });

    it.each(vectors)(
      "preserves the exact $encoding secret using independent check and payload vectors: $check",
      async (v) => {
        const printed = await api.encodeNodeKey(
          { nodeId, name, secret: v.secret },
          scope,
          v.encoding,
        );
        expect(printed.fields).toEqual({ encoding: v.encoding, value: v.value, check: v.check });
        expect(await api.decodeNodeKey(printed.fields, scope, nodeId, name)).toBe(v.secret);
      },
    );

    it("reports exact standard-key and combined counts without altering the existing secret", async () => {
      const printed = await api.encodeNodeKey(
        { nodeId, name, secret: raw.secret },
        scope,
        "raw192",
      );
      expect(printed.enteredCharacters).toBe(47);
      expect(printed.displayedCharacters).toBe(57);
      const register = await api.encodePosition(scope, position);
      expect(register.enteredCharacters + printed.enteredCharacters).toBe(67);
      expect(register.displayedCharacters + printed.displayedCharacters).toBe(80);
    });

    it.each(additionalVectors.vectors)(
      "preserves exact key byte boundaries and original text: $value",
      async (v) => {
        const printed = await api.encodeNodeKey(
          { nodeId, name, secret: v.secret },
          scope,
          v.encoding as PrintedNodeFields["encoding"],
        );
        expect(printed).toEqual({
          fields: { encoding: v.encoding, value: v.value, check: v.check },
          enteredCharacters: v.entered,
          displayedCharacters: v.displayed,
        });
        const register = await api.encodePosition(scope, position);
        expect(register.enteredCharacters + printed.enteredCharacters).toBe(v.combinedEntered);
        expect(register.displayedCharacters + printed.displayedCharacters).toBe(
          v.combinedDisplayed,
        );
        expect(await api.decodeNodeKey(printed.fields, scope, nodeId, name)).toBe(v.secret);
      },
    );

    it.each([
      { encoding: "utf8", value: "C5", check: "1EYNG0Q6" },
      { encoding: "utf8", value: "C40", check: "1EYNG0Q6" },
      { encoding: "utf8", value: "ZW", check: "3B0DKAG0" },
      { encoding: "utf8", value: "ZW", check: "ZAZDZA2Z" },
      { encoding: "raw192", value: "000G40R40M30E209185GR38E1W8124GK2GAHC5RR", check: "MN751NBW" },
      { encoding: "raw192", value: raw.value, check: "7BHXP0KG" },
    ])(
      "refuses noncanonical bytes or substituted byte length even with the decoded-secret check %#",
      async (v) => {
        await expect(
          api.decodeNodeKey(v as PrintedNodeFields, scope, nodeId, name),
        ).rejects.toThrow(refused);
      },
    );

    it("preserves long imported UTF-8 keys and reports their actual byte-based counts", async () => {
      const secret = "λ".repeat(5000);
      const printed = await api.encodeNodeKey({ nodeId, name, secret }, scope, "utf8");
      expect(printed.enteredCharacters).toBe(16008);
      expect(printed.displayedCharacters).toBe(20008);
      expect(await api.decodeNodeKey(printed.fields, scope, nodeId, name)).toBe(secret);
    });

    it("binds explicit encoding even where raw and text payloads have identical lengths", async () => {
      const printed = await api.encodeNodeKey(
        { nodeId, name, secret: vectors[2]!.secret },
        scope,
        "utf8",
      );
      expect(printed.enteredCharacters).toBe(47);
      await expect(
        api.decodeNodeKey({ ...printed.fields, encoding: "raw192" }, scope, nodeId, name),
      ).rejects.toThrow(refused);
      await expect(
        api.decodeNodeKey(
          { encoding: "utf8", value: raw.value, check: raw.check },
          scope,
          nodeId,
          name,
        ),
      ).rejects.toThrow(refused);
    });

    it.each([
      { value: raw.value.slice(0, -1) + "S" },
      { value: raw.value + "0" },
      { value: raw.value.slice(0, -1) },
      { check: "BTBY78WQ" },
      { encoding: "generated" },
      { extra: true },
    ])("refuses noncanonical standard key length, padding, encoding or check %#", async (patch) => {
      await expect(
        api.decodeNodeKey(
          { encoding: "raw192", value: raw.value, check: raw.check, ...patch } as PrintedNodeFields,
          scope,
          nodeId,
          name,
        ),
      ).rejects.toThrow(refused);
    });

    it.each(["0", "000", "000000", "000000000", "01", "ZZ", "0O1", "ZZZZ"])(
      "refuses impossible byte lengths, nonzero padding or invalid UTF-8: %s",
      async (value) => {
        await expect(
          api.decodeNodeKey({ encoding: "utf8", value, check: "00000000" }, scope, nodeId, name),
        ).rejects.toThrow(refused);
      },
    );

    it.each([
      { scope: { ...scope, environment: "preproduction" as const }, nodeId, name },
      { scope: { ...scope, taxpayerNif: "89890002K" }, nodeId, name },
      { scope: { ...scope, softwareId: "W2" }, nodeId, name },
      { scope, nodeId: "another-node", name },
      { scope, nodeId, name: "another-key" },
    ])("refuses the wrong frozen recovery context %#", async (context) => {
      await expect(
        api.decodeNodeKey(
          { encoding: "raw192", value: raw.value, check: raw.check },
          context.scope,
          context.nodeId,
          context.name,
        ),
      ).rejects.toThrow(refused);
    });

    it.each(["", "A".repeat(31), "A".repeat(33), "!".repeat(32), "λ".repeat(32)])(
      "refuses a malformed standard secret %#",
      async (secret) => {
        await expect(api.encodeNodeKey({ nodeId, name, secret }, scope, "raw192")).rejects.toThrow(
          refused,
        );
      },
    );

    it.each(["", "\ud800", "\udc00"])("refuses empty or lossy UTF-8 secrets %#", async (secret) => {
      await expect(api.encodeNodeKey({ nodeId, name, secret }, scope, "utf8")).rejects.toThrow(
        refused,
      );
    });

    it("refuses malformed runtime containers instead of accepting coercion or hidden fields", async () => {
      for (const bad of [null, [], "scope", { ...scope, softwareId: ["W1"] }])
        await expect(api.encodePosition(bad as unknown as RegisterScope, position)).rejects.toThrow(
          refused,
        );
      for (const bad of [null, [], { ...position, extra: 1 }, { ...position, sHighWater: "42" }])
        await expect(api.encodePosition(scope, bad as typeof position)).rejects.toThrow(refused);
      for (const bad of [null, [], { ...fields, check: ["DFZJDGAN"] }])
        await expect(
          api.decodePosition(bad as unknown as PrintedPositionFields, scope),
        ).rejects.toThrow(refused);
      for (const bad of ["", " padded ", "node\n", "a".repeat(257)]) {
        await expect(
          api.encodeNodeKey({ nodeId: bad, name, secret: raw.secret }, scope, "raw192"),
        ).rejects.toThrow(refused);
        await expect(
          api.decodeNodeKey(
            { encoding: "raw192", value: raw.value, check: raw.check },
            scope,
            nodeId,
            bad,
          ),
        ).rejects.toThrow(refused);
      }
    });
  });
}
