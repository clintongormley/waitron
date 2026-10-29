import type { SupportedLocale } from "@waitron/shared";

interface Captions {
  widthQuestion: string;
  qrQuestion: string;
}

export const CALIBRATION_PAGE_WORDS: Readonly<Record<SupportedLocale, Captions>> = {
  "es-ES": {
    widthQuestion: "¿Cuál es el último número de la regla que se ve entero?",
    qrQuestion:
      "Mida con una regla el cuadrado negro del QR. Ignore el borde blanco. ¿Mide más cerca de 40 mm o de 45 mm? No hace falta escanear el código.",
  },
  "en-GB": {
    widthQuestion: "Which is the last number on the ruler that you can see in full?",
    qrQuestion:
      "Measure the black square of the QR with a ruler. Ignore the white border. Is it closer to 40 mm or 45 mm? No need to scan the code.",
  },
};
