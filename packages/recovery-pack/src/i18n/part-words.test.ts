import { describe, expect, it } from "vitest";
import { PART_WORDS } from "./pack-words.js";
import { partFailure } from "./part-words.js";

const CODES = [
  ["backup.archive_settings_unreadable", {}],
  ["backup.recovery_key_missing", {}],
  ["backup.recovery_key_too_short", { min: 12 }],
  ["backup.stream_signer_missing", {}],
  ["sif.allocation_invalid", { reason: "history_invalid" }],
  ["sif.allocation_invalid", { reason: "something_else" }],
  ["recovery.pack_invalid", { reason: "module_unsupported" }],
  ["anything.else", {}],
] as const;

describe("part failure words", () => {
  it.each(CODES)("%s has English and Spanish that differ", (code, params) => {
    const en = partFailure("en", code, params);
    const es = partFailure("es", code, params);
    for (const words of [en, es]) {
      expect(words.what).not.toBe("");
      expect(words.todo).not.toBe("");
    }
    expect(es.what).not.toBe(en.what);
    expect(es.todo).not.toBe(en.todo);
  });

  it("names Backups → Change the recovery key for a missing or short backup key", () => {
    for (const code of ["backup.recovery_key_missing", "backup.recovery_key_too_short"]) {
      expect(partFailure("en", code, {}).todo).toContain("Backups → Change the recovery key");
      expect(partFailure("es", code, {}).todo).toContain(
        "Copias de seguridad → Cambiar la clave de recuperación",
      );
    }
  });

  it("says in words what disagrees for a contradicting invoice-series history", () => {
    expect(partFailure("en", "sif.allocation_invalid", { reason: "history_invalid" }).what).toBe(
      "The box's record of its invoice series disagrees with what setup recorded.",
    );
  });

  it("words a box with no server key yet in both languages", () => {
    expect(PART_WORDS.en.noServerKey).toEqual({
      what: "This box has no server key yet.",
      todo: "There is nothing to keep for this part until the box has one.",
    });
    const es = PART_WORDS.es.noServerKey;
    expect(es.what).not.toBe("");
    expect(es.todo).not.toBe("");
    expect(es.what).not.toBe(PART_WORDS.en.noServerKey.what);
    expect(es.todo).not.toBe(PART_WORDS.en.noServerKey.todo);
  });

  it("calls a module composition the page cannot use a fault in Waitron, not a reason to make a new pack", () => {
    expect(partFailure("en", "recovery.pack_invalid", { reason: "module_unsupported" })).toEqual({
      what: "This page could not be made. That is a fault in Waitron.",
      todo: "A new pack will fail here the same way. The other pages of this pack are still good.",
    });
    expect(partFailure("es", "recovery.pack_invalid", { reason: "module_unsupported" })).toBe(
      PART_WORDS.es.moduleFault,
    );
  });

  it("answers the general wording for any other code, and for another reason of a known one", () => {
    const general = partFailure("en", "anything.else", {});
    expect(general).toEqual({
      what: "This part could not be read when this pack was made.",
      todo: "Check Backups and make a new pack.",
    });
    expect(partFailure("en", "sif.allocation_invalid", { reason: "other" })).toEqual(general);
    expect(partFailure("en", "recovery.pack_invalid", { reason: "shape" })).toEqual(general);
  });

  it("never prints a parameter's value", () => {
    const params = { reason: "history_invalid", min: 987654, detail: "s3cr3t" };
    for (const [code] of CODES)
      for (const locale of ["en", "es"] as const) {
        const { what, todo } = partFailure(locale, code, params);
        expect(`${what} ${todo}`).not.toMatch(/987654|s3cr3t/);
      }
  });

  it("words the server-key lines in both languages", () => {
    for (const locale of ["en", "es"] as const) {
      const w = PART_WORDS[locale];
      expect(w.currentKeyOnPack(3, "2 Sept")).toContain("3");
      expect(w.currentKeyOnUnreceivedPack(3, "2 Sept")).toContain("2 Sept");
      expect(w.currentKeyOnSheet("2026-09-02 · K", "2 Sept")).toContain("2026-09-02 · K");
      expect(w.alsoServerKey(6)).toContain("6");
    }
    expect(PART_WORDS.en.currentKeyOnPack(3, "2 September 2026")).toBe(
      "The current key, on recovery pack 3 made on 2 September 2026, still works.",
    );
    expect(PART_WORDS.en.currentKeyOnUnreceivedPack(3, "2 September 2026")).toBe(
      "The current server key is on recovery pack 3, made on 2 September 2026, but when this pack was made the box had not been told that pack 3 arrived. If you do not have pack 3, make a new pack with Also make a new server key ticked.",
    );
  });

  it("prints a part's check as the key's day and the first eight characters of the revision", () => {
    expect(PART_WORDS.en.check("20 Sept 2026", "0123456789abcdef")).toBe(
      "key of 20 Sept 2026 · rev 01234567",
    );
    expect(PART_WORDS.es.check("20 sept 2026", "0123456789abcdef")).toBe(
      "clave del 20 sept 2026 · rev 01234567",
    );
    expect(PART_WORDS.en.check("20 Sept 2026", undefined)).toBe("key of 20 Sept 2026");
    expect(PART_WORDS.es.check("20 sept 2026", undefined)).toBe("clave del 20 sept 2026");
  });
});
