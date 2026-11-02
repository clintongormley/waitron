export const ATTENDANCE_EMAIL_WORDS = {
  en: {
    missingBoth: "clock in or out",
    missingIn: "clock in",
    missingOut: "clock out",
    subject: (businessDay: string) => `Missing clock times: ${businessDay}`,
    text: (businessDay: string, venueName: string, missing: string) =>
      `On ${businessDay} at ${venueName}, you did not ${missing}. Fix your hours at your next clock-in.`,
  },
  es: {
    missingBoth: "fichar la entrada o la salida",
    missingIn: "fichar la entrada",
    missingOut: "fichar la salida",
    subject: (businessDay: string) => `Fichajes pendientes: ${businessDay}`,
    text: (businessDay: string, venueName: string, missing: string) =>
      `El ${businessDay}, en ${venueName}, faltó ${missing}. Corrige las horas en tu próximo fichaje de entrada.`,
  },
} as const;
