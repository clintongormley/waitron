import { describe, expect, it } from "vitest";

describe("calibration ruler wording", () => {
  it.each([
    [
      "en-GB",
      "Which is the last number on the ruler that you can see in full?",
      "Measure the black square of the QR with a ruler. Ignore the white border. Is it closer to 40 mm or 45 mm? No need to scan the code.",
    ],
    [
      "es-ES",
      "¿Cuál es el último número de la regla que se ve entero?",
      "Mida con una regla el cuadrado negro del QR. Ignore el borde blanco. ¿Mide más cerca de 40 mm o de 45 mm? No hace falta escanear el código.",
    ],
  ] as const)(
    "provides both %s measurement questions",
    async (locale, widthQuestion, qrQuestion) => {
      const { CALIBRATION_PAGE_WORDS } = await import("./test-page.js");
      expect(CALIBRATION_PAGE_WORDS[locale]).toEqual({ widthQuestion, qrQuestion });
    },
  );
});
