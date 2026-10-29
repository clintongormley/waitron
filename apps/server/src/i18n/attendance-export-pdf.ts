export const ATTENDANCE_PDF_WORDS = {
  en: {
    title: "Working-time record",
    period: (start: string, end: string) => `From ${start}  /  Before (excluded) ${end}`,
    continued: (heading: string) => `${heading} (continued)`,
    unavailableCharacters: "Characters unavailable in the font are shown as [U+XXXX].",
    page: (page: number, total: number) => `Page ${page} / ${total}`,
  },
  es: {
    title: "Registro de jornada",
    period: (start: string, end: string) => `Desde ${start}  /  Antes de (excluido) ${end}`,
    continued: (heading: string) => `${heading} (continuación)`,
    unavailableCharacters: "Caracteres no disponibles en la fuente: se muestran como [U+XXXX].",
    page: (page: number, total: number) => `Página ${page} / ${total}`,
  },
} as const;
