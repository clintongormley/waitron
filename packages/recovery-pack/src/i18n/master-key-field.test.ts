import { describe, expect, it } from "vitest";
import { MASTER_KEY_DAMAGED_NO_SCAN, MASTER_KEY_FIELD_WORDS } from "./master-key-field.js";

describe("the master-key field's words", () => {
  it("names the key, the pack button and each refusal in English", () => {
    const words = MASTER_KEY_FIELD_WORDS.en;
    expect(words.label).toBe("Master key");
    expect(words.button).toBe("Choose the recovery pack PDF");
    expect(words.notPack).toBe("This PDF is not a recovery pack.");
    expect(words.damaged).toBe("This recovery pack PDF is damaged. Type the key or scan it.");
    expect(words.notWhole).toBe("Not a whole master key. Check it against the recovery pack.");
    expect(words.wrongKey("2026-11-23 · QZJV")).toBe(
      "Wrong master key. Use the one dated 2026-11-23 · QZJV.",
    );
    expect(MASTER_KEY_DAMAGED_NO_SCAN.en).toBe("This recovery pack PDF is damaged. Type the key.");
  });

  it("names the key, the pack button and each refusal in Spanish", () => {
    const words = MASTER_KEY_FIELD_WORDS.es;
    expect(words.label).toBe("Clave maestra");
    expect(words.button).toBe("Elegir el PDF del paquete de recuperación");
    expect(words.notPack).toBe("Este PDF no es un paquete de recuperación.");
    expect(words.damaged).toBe(
      "Este PDF del paquete de recuperación está dañado. Escribe la clave o escanéala.",
    );
    expect(words.notWhole).toBe(
      "No es una clave maestra completa. Compárala con el paquete de recuperación.",
    );
    expect(words.wrongKey("2026-11-23 · QZJV")).toBe(
      "Clave maestra incorrecta. Usa la del 2026-11-23 · QZJV.",
    );
    expect(MASTER_KEY_DAMAGED_NO_SCAN.es).toBe(
      "Este PDF del paquete de recuperación está dañado. Escribe la clave.",
    );
  });

  it("says which pack holds the master key, when it is known", () => {
    expect(MASTER_KEY_FIELD_WORDS.en.elsewhere(2)).toBe(
      "This recovery pack does not hold the master key. It is on recovery pack 2: choose that pack, or type the key from it.",
    );
    expect(MASTER_KEY_FIELD_WORDS.en.elsewhere(null)).toBe(
      "This recovery pack does not hold the master key: choose the pack that holds it, or type the key from it.",
    );
    expect(MASTER_KEY_FIELD_WORDS.es.elsewhere(2)).toBe(
      "Este paquete de recuperación no tiene la clave maestra. Está en el paquete de recuperación 2: elige ese paquete o introduce su clave.",
    );
    expect(MASTER_KEY_FIELD_WORDS.es.elsewhere(null)).toBe(
      "Este paquete de recuperación no tiene la clave maestra: elige el paquete que la tiene o introduce su clave.",
    );
  });
});
