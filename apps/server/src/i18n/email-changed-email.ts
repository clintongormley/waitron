export const EMAIL_CHANGED_WORDS = {
  en: {
    subject: "Your sign-in email was changed",
    text: (actor: string, venue: string, when: string) =>
      `${actor} changed the email address you sign in with at ${venue} on ${when}. Messages for your account now go to the new address.`,
  },
  es: {
    subject: "Se cambió tu correo de acceso",
    text: (actor: string, venue: string, when: string) =>
      `${actor} cambió el correo con el que entras en ${venue} el ${when}. Los mensajes de tu cuenta ahora van a la nueva dirección.`,
  },
} as const;
