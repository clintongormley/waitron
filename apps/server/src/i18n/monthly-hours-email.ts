export const MONTHLY_HOURS_EMAIL_WORDS = {
  en: {
    subject: (month: string) => `Review hours for ${month}`,
    text: (count: number, month: string, date: string, url: string) =>
      `${count} ${count === 1 ? "issue is" : "issues are"} open. Hours for ${month} close on ${date}.\n\nOpen Hours and choose ${month}\n${url}`,
  },
  es: {
    subject: (month: string) => `Revisa las horas de ${month}`,
    text: (count: number, month: string, date: string, url: string) =>
      `Hay ${count} ${count === 1 ? "asunto pendiente" : "asuntos pendientes"}. Las horas de ${month} se cierran el ${date}.\n\nAbre Horas y elige ${month}\n${url}`,
  },
};
