export const SECURITY_CHANGE_EMAIL_WORDS = {
  en: {
    subject: "Your account security changed",
    changes: {
      password_changed: "Your password was changed.",
      passkey_added: "A passkey was added to your account.",
      passkey_removed: "A passkey was removed from your account.",
      authenticator_set_up: "An authenticator was set up for your account.",
      authenticator_removed: "The authenticator was removed from your account.",
      recovery_codes_regenerated: "Your recovery codes were regenerated.",
      email_changed: "Your sign-in email address was changed.",
      google_connected: "Google sign-in was connected to your account.",
      google_disconnected: "Google sign-in was disconnected from your account.",
    },
    text: (venue: string, change: string, when: string) =>
      `${venue}: ${change} Changed on ${when}.\n\nIf this was not you, sign in, remove any sign-in method you don't recognise and change your password; if you can't sign in, ask a venue administrator to reset your sign-in.`,
  },
  es: {
    subject: "Cambió la seguridad de tu cuenta",
    changes: {
      password_changed: "Se cambió tu contraseña.",
      passkey_added: "Se añadió una llave de acceso a tu cuenta.",
      passkey_removed: "Se eliminó una llave de acceso de tu cuenta.",
      authenticator_set_up: "Se configuró un autenticador para tu cuenta.",
      authenticator_removed: "Se eliminó el autenticador de tu cuenta.",
      recovery_codes_regenerated: "Se regeneraron tus códigos de recuperación.",
      email_changed: "Se cambió tu correo de acceso.",
      google_connected: "Se conectó el acceso con Google a tu cuenta.",
      google_disconnected: "Se desconectó el acceso con Google de tu cuenta.",
    },
    text: (venue: string, change: string, when: string) =>
      `${venue}: ${change} Cambio realizado el ${when}.\n\nSi no has sido tú, entra, elimina cualquier método de acceso que no reconozcas y cambia tu contraseña; si no puedes entrar, pide a un administrador del local que restablezca tu acceso.`,
  },
} as const;
