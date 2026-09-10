import nodemailer from "nodemailer";
import type { AccountActionPurpose } from "@waitron/identity";

export interface AccountEmail {
  purpose: AccountActionPurpose;
  email: string;
  displayName: string;
  actionUrl: string;
  code?: string;
  codeExpiresAt?: string;
  expiresAt: string;
  locale: string;
  privacyNoticeUrl?: string;
}

export type AccountEmailSender = (message: AccountEmail) => Promise<void>;

interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const COPY = {
  en: {
    invitationSubject: "Set up your Waitron account",
    resetSubject: "Reset your Waitron password",
    emailChangeSubject: "Confirm your new Waitron email",
    hello: (name: string) => `Hello ${name},`,
    invitationAction: "set up your account",
    resetAction: "reset your password",
    invitationLink: "Set up your account",
    resetLink: "Reset your password",
    emailChangeAction: "confirm your new email address",
    emailChangeLink: "Open your Waitron profile",
    expires: (expiry: string) => `This single-use link expires at ${expiry}.`,
    code: (code: string, expiry: string) =>
      `At the restaurant, enter ${code} on the Waitron login screen. This code expires at ${expiry}.`,
    emailChangeCode: (code: string, expiry: string) =>
      `Enter ${code} in your Waitron profile. This code expires at ${expiry}.`,
    ignore: "If you did not expect this email, you can ignore it.",
    privacy: "Privacy notice",
  },
  es: {
    invitationSubject: "Configura tu cuenta de Waitron",
    resetSubject: "Restablece tu contraseña de Waitron",
    emailChangeSubject: "Confirma tu nuevo correo de Waitron",
    hello: (name: string) => `Hola ${name},`,
    invitationAction: "configurar tu cuenta",
    resetAction: "restablecer tu contraseña",
    invitationLink: "Configura tu cuenta",
    resetLink: "Restablece tu contraseña",
    emailChangeAction: "confirmar tu nueva dirección de correo",
    emailChangeLink: "Abre tu perfil de Waitron",
    expires: (expiry: string) => `Este enlace de un solo uso caduca el ${expiry}.`,
    code: (code: string, expiry: string) =>
      `En el restaurante, introduce ${code} en la pantalla de inicio de sesión de Waitron. Este código caduca el ${expiry}.`,
    emailChangeCode: (code: string, expiry: string) =>
      `Introduce ${code} en tu perfil de Waitron. Este código caduca el ${expiry}.`,
    ignore: "Si no esperabas este correo, puedes ignorarlo.",
    privacy: "Aviso de privacidad",
  },
} as const;

/** Build an SMTP-backed sender. The optional transport is the unit-test seam. */
export function createAccountEmailSender(
  config: { url: string; from: string },
  transport: MailTransport = nodemailer.createTransport(config.url),
): AccountEmailSender {
  return async (message) => {
    const copy = message.locale.startsWith("es") ? COPY.es : COPY.en;
    const subject =
      message.purpose === "invitation"
        ? copy.invitationSubject
        : message.purpose === "password_reset"
          ? copy.resetSubject
          : copy.emailChangeSubject;
    const action =
      message.purpose === "invitation"
        ? copy.invitationAction
        : message.purpose === "password_reset"
          ? copy.resetAction
          : copy.emailChangeAction;
    const link =
      message.purpose === "invitation"
        ? copy.invitationLink
        : message.purpose === "password_reset"
          ? copy.resetLink
          : copy.emailChangeLink;
    // Accounts are tenant-wide and a tenant may span time zones, so expiry is explicit UTC while its
    // words and date order follow the recipient's UI locale.
    const expiry = new Intl.DateTimeFormat(message.locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(message.expiresAt));
    const codeExpiry = new Intl.DateTimeFormat(message.locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(message.codeExpiresAt ?? message.expiresAt));
    const codeCopy =
      message.code === undefined
        ? undefined
        : message.purpose === "email_change"
          ? copy.emailChangeCode(message.code, codeExpiry)
          : copy.code(message.code, codeExpiry);
    const text = [
      copy.hello(message.displayName),
      "",
      `${message.locale.startsWith("es") ? "Usa este enlace para" : "Use this link to"} ${action}:`,
      message.actionUrl,
      ...(codeCopy === undefined ? [] : ["", codeCopy]),
      "",
      copy.expires(expiry),
      copy.ignore,
      ...(message.privacyNoticeUrl === undefined ? [] : [copy.privacy, message.privacyNoticeUrl]),
    ].join("\n");
    const html = `<p>${escapeHtml(copy.hello(message.displayName))}</p>
<p><a href="${escapeHtml(message.actionUrl)}">${link}</a></p>
${codeCopy === undefined ? "" : `<p>${escapeHtml(codeCopy)}</p>`}
<p>${escapeHtml(copy.expires(expiry))}</p>
<p>${escapeHtml(copy.ignore)}</p>
${
  message.privacyNoticeUrl === undefined
    ? ""
    : `<p><a href="${escapeHtml(message.privacyNoticeUrl)}">${escapeHtml(copy.privacy)}</a></p>`
}`;
    await transport.sendMail({
      from: config.from,
      to: message.email,
      subject,
      text,
      html,
    });
  };
}
