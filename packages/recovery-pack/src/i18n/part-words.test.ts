import { describe, expect, it } from "vitest";
import { partFailure } from "./part-words.js";

const CODES = [
  "backup.recovery_key_missing",
  "backup.recovery_key_too_short",
  "backup.stream_signer_missing",
  "anything.else",
] as const;

describe("part failure words", () => {
  it.each(CODES)("%s has English and Spanish that differ", (code) => {
    const en = partFailure("en", code);
    const es = partFailure("es", code);
    for (const words of [en, es]) {
      expect(words.what).not.toBe("");
      expect(words.todo).not.toBe("");
    }
    expect(es.what).not.toBe(en.what);
    expect(es.todo).not.toBe(en.todo);
  });

  it("names Backups → Recovery pack → Change the backup key for a missing or short backup key", () => {
    for (const code of ["backup.recovery_key_missing", "backup.recovery_key_too_short"]) {
      expect(partFailure("en", code).todo).toContain(
        "Backups → Recovery pack → Change the backup key",
      );
      expect(partFailure("es", code).todo).toContain(
        "Copias de seguridad → Paquete de recuperación → Cambiar la clave de las copias",
      );
      for (const locale of ["en", "es"] as const) {
        const words = partFailure(locale, code);
        expect(`${words.what} ${words.todo}`).not.toMatch(/encryption key|clave de cifrado/);
      }
    }
  });

  it.each(["en", "es"] as const)(
    "names the card's Print the recovery pack, never the old make-a-new-pack action, in every %s to-do",
    (locale) => {
      const action = { en: "print the recovery pack", es: "imprime el paquete de recuperación" }[
        locale
      ];
      for (const code of CODES) {
        const { todo } = partFailure(locale, code);
        expect(todo.toLowerCase(), code).toContain(action);
        expect(todo, code).not.toMatch(/new pack|paquete nuevo/i);
      }
    },
  );

  it("answers the general wording for any other code", () => {
    const general = partFailure("en", "anything.else");
    expect(general).toEqual({
      what: "This part could not be read when this pack was made.",
      todo: "Check Backups and print the recovery pack.",
    });
    expect(partFailure("en", "sif.allocation_invalid")).toEqual(general);
    expect(partFailure("en", "recovery.pack_invalid")).toEqual(general);
  });
});
