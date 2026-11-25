export const MONTHLY_HOURS_EMAIL_WORDS = {
  en: {
    subject: (month: string) => `Review hours for ${month}`,
    text: (count: number, month: string, date: string, url: string) =>
      `${count} ${count === 1 ? "issue needs" : "issues need"} your attention before hours for ${month} close on ${date}.\n\nOpen Hours and choose ${month}\n${url}`,
  },
  es: {
    subject: (month: string) => `Revisa las horas de ${month}`,
    text: (count: number, month: string, date: string, url: string) =>
      `Tienes ${count} ${count === 1 ? "asunto pendiente" : "asuntos pendientes"} antes del cierre de las horas de ${month}, el ${date}.\n\nAbre Horas y elige ${month}\n${url}`,
  },
};
