import type { SupportedLocale } from "@waitron/shared";

export const PRINTER_TEST_SAMPLE_TEXT = "Café, jamón, niño · 5 € · ¿Sí? ¡Sí!";

export const PRINTER_TEST_PAGE_WORDS: Readonly<
  Record<SupportedLocale, { title: string; verdict: string }>
> = {
  "en-GB": {
    title: "Test page",
    verdict: "If this is centred and readable, this printer is set up correctly.",
  },
  "es-ES": {
    title: "Página de prueba",
    verdict: "Si esto sale centrado y legible, la impresora está bien configurada.",
  },
};
