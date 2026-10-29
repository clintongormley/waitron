import { describe, expect, it } from "vitest";

describe("printer test page wording", () => {
  it.each([
    ["en-GB", "Test page", "If this is centred and readable, this printer is set up correctly."],
    [
      "es-ES",
      "Página de prueba",
      "Si esto sale centrado y legible, la impresora está bien configurada.",
    ],
  ] as const)("provides the %s title and setup verdict", async (locale, title, verdict) => {
    const { PRINTER_TEST_PAGE_WORDS, PRINTER_TEST_SAMPLE_TEXT } =
      await import("./printer-test-page.js");
    expect(PRINTER_TEST_PAGE_WORDS[locale]).toEqual({ title, verdict });
    expect(PRINTER_TEST_SAMPLE_TEXT).toBe("Café, jamón, niño · 5 € · ¿Sí? ¡Sí!");
  });
});

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
