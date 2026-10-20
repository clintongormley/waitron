import { describe, expect, it } from "vitest";
import type { CompactRegisterFields, CompactNodeKey } from "../custodian/register-compact.js";

export function describeRegisterCompact() {
  const scope = { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" as const };
  const custodianId = "10000000-0000-4000-8000-000000000001";
  const trust = {
    scope: { ...scope, custodianId },
    publicKey:
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=\n-----END PUBLIC KEY-----\n",
    fingerprint: "06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9",
  };
  const head = { registerId: "register-1", revision: "7", digest: "a".repeat(64) };
  const fields = {
    referenceKind: "uuid" as const,
    custodianReference: "EAAAAAAAQACAAAAAAAAAAQ",
    custodySeed: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
    sPosition: "000042",
    pPosition: "000007",
    sourceHeadTag: "BWCQKQ9376R274Y3",
    check: "V0KA32WB",
  };
  const known = {
    sHighWater: 0,
    pHighWater: 0,
    currentHead: null,
    retainedHeads: [],
    retainedOriginals: [],
  };
  const context = { scope, expected: trust, known };
  const load = () => import("@waitron/fiscal-verifactu/register-compact");

  describe("compact paper recovery", () => {
    it.each([
      { taxpayerNif: "bad" },
      { softwareId: "bad" },
      { environment: "unknown" },
      { secret: "unexpected" },
    ])("refuses an invalid compact recovery scope %#", async (patch) => {
      const api = await load();
      await expect(
        api.recoverCompactRegister(fields, {
          ...context,
          scope: { ...scope, ...patch } as typeof scope,
        }),
      ).rejects.toThrow("Custody material refused");
    });
    it.each([-1, 0.5, 1000000, Number.NaN])(
      "refuses invalid retained position %s instead of weakening the floor",
      async (position) => {
        const api = await load();
        await expect(
          api.recoverCompactRegister(fields, {
            ...context,
            known: { ...known, sHighWater: position },
          }),
        ).rejects.toThrow("Custody material refused");
      },
    );
    it("refuses a retained old head when no current head has been established", async () => {
      const api = await load();
      await expect(
        api.recoverCompactRegister(fields, {
          ...context,
          known: { ...known, retainedHeads: [head] },
        }),
      ).rejects.toThrow("Custody material refused");
    });
    it.each([null, 42])("refuses a non-text compact position %#", async (sPosition) => {
      const api = await load();
      await expect(
        api.recoverCompactRegister(
          {
            ...fields,
            sPosition: sPosition as unknown as string,
          },
          context,
        ),
      ).rejects.toThrow("Custody material refused");
    });
    it.each(["", " leading", "trailing ", "line\nbreak", "x".repeat(257)])(
      "refuses an invalid independently bound custodian id %#",
      async (boundCustodianId) => {
        const api = await load();
        await expect(
          api.recoverCompactRegister(
            { ...fields, custodianReference: null },
            {
              ...context,
              boundCustodianId,
            },
          ),
        ).rejects.toThrow("Custody material refused");
      },
    );
    it.each([
      { secret: "" },
      { secret: "short" },
      { secret: " ".repeat(32) },
      { nodeId: "" },
      { name: "bad\nname" },
    ])("does not print an unusable generated recovery key %#", async (patch) => {
      const api = await load();
      await expect(
        api.encodeCompactNodeKey(
          {
            nodeId: "node-1",
            name: "Olivo recovery",
            secret: "0123456789abcdefghijklmnopqrstuv",
            ...patch,
          },
          scope,
          "generated",
        ),
      ).rejects.toThrow("Custody material refused");
    });
    it("refuses unknown compact key formats on both output and input", async () => {
      const api = await load();
      const node = {
        nodeId: "node-1",
        name: "Olivo recovery",
        secret: "0123456789abcdefghijklmnopqrstuv",
      };
      await expect(api.encodeCompactNodeKey(node, scope, "unknown" as "generated")).rejects.toThrow(
        "Custody material refused",
      );
      await expect(
        api.recoverCompactNodeKey(
          { nodeKeyFormat: "unknown" as "generated", value: node.secret, check: "1BGZ6DAE" },
          {
            scope,
            nodeId: node.nodeId,
            name: node.name,
          },
        ),
      ).rejects.toThrow("Custody material refused");
    });
    it("refuses an invalid generated key before checking its checksum", async () => {
      const api = await load();
      await expect(
        api.recoverCompactNodeKey(
          { nodeKeyFormat: "generated", value: "short", check: "1BGZ6DAE" },
          {
            scope,
            nodeId: "node-1",
            name: "Olivo recovery",
          },
        ),
      ).rejects.toThrow("Custody material refused");
    });
    it("refuses a UUID encoded under the custom-text reference format", async () => {
      const api = await load();
      const encoded = btoa(custodianId)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
      await expect(
        api.recoverCompactRegister(
          { ...fields, referenceKind: "text", custodianReference: encoded },
          context,
        ),
      ).rejects.toThrow("Custody material refused");
    });
    it.each([-1, 0.5, 1000000])(
      "does not print an impossible register position %s",
      async (position) => {
        const api = await load();
        const recovered = await api.recoverCompactRegister(fields, context);
        try {
          await expect(
            api.encodeCompactRegister(recovered.key, { sHighWater: position, pHighWater: 7 }, head),
          ).rejects.toThrow("Custody material refused");
        } finally {
          recovered.key.dispose();
        }
      },
    );
    it("recovers the same signing key from fixed three-field hash vectors without currentness authority", async () => {
      const api = await load();
      expect(await api.registerHeadTag(head)).toBe("BWCQKQ9376R274Y3");
      const result = await api.recoverCompactRegister(fields, context);
      try {
        expect(result.key.publicKey).toBe(trust.publicKey);
        expect(result.key.fingerprint).toBe(trust.fingerprint);
        expect(result).toMatchObject({
          position: { sHighWater: 42, pHighWater: 7 },
          sourceHeadTag: "BWCQKQ9376R274Y3",
          completeHistory: false,
          currentnessRequired: true,
        });
        const encoded = await api.encodeCompactRegister(result.key, result.position, head);
        expect(encoded.fields).toEqual(fields);
        expect(encoded).toMatchObject({ enteredCharacters: 101, displayedCharacters: 117 });
        expect(
          Object.values(encoded.fields)
            .filter((v) => typeof v === "string")
            .map((s) => s.length),
        ).toEqual([4, 22, 43, 6, 6, 16, 8]);
        expect(
          (await api.encodeCompactRegister(result.key, result.position, head, true))
            .enteredCharacters,
        ).toBe(79);
      } finally {
        result.key.dispose();
      }
      await expect(api.encodeCompactRegister(result.key, result.position, head)).rejects.toThrow();
    });
    it("allows an omitted reference only when its exact identity is independently bound", async () => {
      const api = await load();
      const result = await api.recoverCompactRegister(
        { ...fields, custodianReference: null },
        { ...context, boundCustodianId: custodianId },
      );
      expect(result.key.scope.custodianId).toBe(custodianId);
      result.key.dispose();
      await expect(
        api.recoverCompactRegister({ ...fields, custodianReference: null }, context),
      ).rejects.toThrow();
      await expect(
        api.recoverCompactRegister(fields, { ...context, boundCustodianId: "other" }),
      ).rejects.toThrow();
    });
    it("preserves custom text and explicitly distinguishes equal-length U and T references", async () => {
      const api = await load();
      const original = await api.recoverCompactRegister(fields, context);
      try {
        const customTrust = { ...trust, scope: { ...scope, custodianId: "abcdefghijklmnop" } };
        const custom = await api.recoverCompactRegister(fields, context);
        const { fromDer, material } = await import("../custodian/internal.js");
        const customKey = await fromDer(
          material(custom.key).der,
          customTrust.scope,
          "secret-paper",
          customTrust,
        );
        custom.key.dispose();
        try {
          const text = await api.encodeCompactRegister(
            customKey,
            { sHighWater: 42, pHighWater: 7 },
            head,
          );
          expect(text.fields).toMatchObject({
            referenceKind: "text",
            custodianReference: "YWJjZGVmZ2hpamtsbW5vcA",
          });
          expect(text.enteredCharacters).toBe(101);
          const recovered = await api.recoverCompactRegister(text.fields, {
            ...context,
            expected: customTrust,
          });
          expect(recovered.key.scope.custodianId).toBe("abcdefghijklmnop");
          recovered.key.dispose();
          await expect(
            api.recoverCompactRegister(
              { ...text.fields, referenceKind: "uuid" },
              { ...context, expected: customTrust },
            ),
          ).rejects.toThrow();
        } finally {
          customKey.dispose();
        }
      } finally {
        original.key.dispose();
      }
    });
    it.each([
      { custodySeed: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2B" },
      { custodySeed: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A=" },
      { custodySeed: "!".repeat(43) },
      { check: "00000000" },
      { sPosition: "000043" },
      { sPosition: "-00001" },
      { pPosition: "1000000" },
      { pPosition: "0000000" },
      { sourceHeadTag: "O".repeat(16) },
      { referenceKind: "text" },
      { referenceKind: "other" },
      { custodianReference: "EAAAAAAAQACAAAAAAAAAAR" },
      { custodySeed: fields.custodySeed + "\u00a0" },
      { custodianReference: fields.custodianReference + "=" },
    ])("refuses malformed, noncanonical or mismatched fields %#", async (changed) => {
      const api = await load();
      await expect(
        api.recoverCompactRegister({ ...fields, ...changed } as CompactRegisterFields, context),
      ).rejects.toThrow();
    });
    it("accepts grouping ASCII whitespace without changing case-sensitive secret bytes", async () => {
      const api = await load();
      const result = await api.recoverCompactRegister(
        {
          ...fields,
          custodySeed: fields.custodySeed.slice(0, 10) + " \n\t" + fields.custodySeed.slice(10),
          check: "V0KA 32WB",
        },
        context,
      );
      expect(result.key.fingerprint).toBe(trust.fingerprint);
      result.key.dispose();
      await expect(
        api.recoverCompactRegister(fields, {
          ...context,
          scope: { ...scope, environment: "preproduction" },
        }),
      ).rejects.toThrow();
      await expect(
        api.recoverCompactRegister(fields, {
          ...context,
          expected: { ...trust, fingerprint: "a".repeat(64) },
        }),
      ).rejects.toThrow();
    });
    it("refuses lower positions and a recognised older head even with equal positions", async () => {
      const api = await load();
      await expect(
        api.recoverCompactRegister(fields, { ...context, known: { ...known, sHighWater: 43 } }),
      ).rejects.toThrow();
      await expect(
        api.recoverCompactRegister(fields, { ...context, known: { ...known, pHighWater: 8 } }),
      ).rejects.toThrow();
      await expect(
        api.recoverCompactRegister(fields, {
          ...context,
          known: {
            ...known,
            currentHead: { ...head, revision: "8", digest: "b".repeat(64) },
            retainedHeads: [head],
          },
        }),
      ).rejects.toThrow();
      const current = await api.recoverCompactRegister(fields, {
        ...context,
        known: { ...known, currentHead: head },
      });
      expect(current.currentnessRequired).toBe(true);
      current.key.dispose();
    });
    it("round trips generated and complete UTF-8 node keys with exact independent checksum vectors", async () => {
      const api = await load();
      const node = {
        nodeId: "node-1",
        name: "Olivo recovery",
        secret: "0123456789abcdefghijklmnopqrstuv",
      };
      const printed = await api.encodeCompactNodeKey(node, scope, "generated");
      expect(printed).toMatchObject({
        nodeKeyFormat: "generated",
        value: node.secret,
        check: "1BGZ6DAE",
        enteredCharacters: 40,
        displayedCharacters: 48,
      });
      expect(
        await api.recoverCompactNodeKey(printed, { scope, nodeId: node.nodeId, name: node.name }),
      ).toBe(node.secret);
      const imported = { ...node, secret: "  clave λ\t\n" };
      const full = await api.encodeCompactNodeKey(imported, scope, "utf8");
      expect(full).toMatchObject({
        nodeKeyFormat: "utf8",
        value: "ICBjbGF2ZSDOuwkK",
        check: "Y1RSZZ4Y",
        enteredCharacters: 24,
      });
      expect(
        await api.recoverCompactNodeKey(full, { scope, nodeId: node.nodeId, name: node.name }),
      ).toBe(imported.secret);
      for (const patch of [
        { check: "00000000" },
        { value: full.value + "=" },
        { value: "_w" },
        { nodeKeyFormat: "generated" },
      ])
        await expect(
          api.recoverCompactNodeKey({ ...full, ...patch } as CompactNodeKey, {
            scope,
            nodeId: node.nodeId,
            name: node.name,
          }),
        ).rejects.toThrow();
      await expect(
        api.recoverCompactNodeKey(printed, { scope, nodeId: "node-2", name: node.name }),
      ).rejects.toThrow();
      await expect(
        api.recoverCompactNodeKey(printed, {
          scope: { ...scope, environment: "preproduction" },
          nodeId: node.nodeId,
          name: node.name,
        }),
      ).rejects.toThrow();
      await expect(
        api.recoverCompactNodeKey(printed, { scope, nodeId: node.nodeId, name: "other" }),
      ).rejects.toThrow();
    });
    it("preserves a long imported key and reports its actual typing count", async () => {
      const api = await load();
      const node = { nodeId: "node-1", name: "Imported recovery", secret: "λ".repeat(5000) };
      const printed = await api.encodeCompactNodeKey(node, scope, "utf8");
      expect(printed.enteredCharacters).toBe(13342);
      expect(
        await api.recoverCompactNodeKey(printed, { scope, nodeId: node.nodeId, name: node.name }),
      ).toBe(node.secret);
    });
  });
}
