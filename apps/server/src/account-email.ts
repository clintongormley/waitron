import { ACCOUNT_EMAIL_WORDS } from "./i18n/account-email.js";
import { ROLE_MEMBERSHIP_EMAIL_WORDS } from "./i18n/role-membership-email.js";
import type { MailMessage } from "./mail-sender.js";
import type { AccountActionPurpose, BuiltInRoleKey } from "@waitron/identity";

export interface AccountEmail {
  purpose: AccountActionPurpose;
  email: string;
  displayName: string;
  actionUrl: string;
  code?: string;
  codeExpiresAt?: string;
  expiresAt: string;
  locale: string;
  roles?: readonly { builtInKey: BuiltInRoleKey | null; name: string | null }[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function composeAccountEmail(
  message: AccountEmail,
  config: { timeZone: string; privacyNoticeUrl?: string },
): MailMessage {
  const spanish = message.locale.startsWith("es");
  const copy = spanish ? ACCOUNT_EMAIL_WORDS.es : ACCOUNT_EMAIL_WORDS.en;
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
  const expiry = new Intl.DateTimeFormat(message.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: config.timeZone,
    timeZoneName: "short",
  }).format(new Date(message.expiresAt));
  const codeExpiry = new Intl.DateTimeFormat(message.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: config.timeZone,
    timeZoneName: "short",
  }).format(new Date(message.codeExpiresAt ?? message.expiresAt));
  const codeCopy =
    message.code !== undefined && message.purpose === "email_change"
      ? copy.emailChangeCode(message.code, codeExpiry)
      : undefined;
  const roleNames = (message.roles ?? []).map((role) =>
    role.builtInKey === null
      ? role.name!
      : ROLE_MEMBERSHIP_EMAIL_WORDS[spanish ? "es" : "en"].roles[role.builtInKey],
  );
  const rolesLine = roleNames.length === 0 ? undefined : copy.yourRoles(roleNames.join(", "));
  const text = [
    copy.hello(message.displayName),
    "",
    ...(rolesLine === undefined ? [] : [rolesLine, ""]),
    `${copy.useLink} ${action}:`,
    message.actionUrl,
    ...(codeCopy === undefined ? [] : ["", codeCopy]),
    "",
    copy.expires(expiry),
    copy.ignore,
    ...(config.privacyNoticeUrl === undefined ? [] : [copy.privacy, config.privacyNoticeUrl]),
  ].join("\n");
  const html = `<p>${escapeHtml(copy.hello(message.displayName))}</p>
${rolesLine === undefined ? "" : `<p>${escapeHtml(rolesLine)}</p>\n`}<p><a href="${escapeHtml(message.actionUrl)}">${link}</a></p>
${codeCopy === undefined ? "" : `<p>${escapeHtml(codeCopy)}</p>`}
<p>${escapeHtml(copy.expires(expiry))}</p>
<p>${escapeHtml(copy.ignore)}</p>
${
  config.privacyNoticeUrl === undefined
    ? ""
    : `<p><a href="${escapeHtml(config.privacyNoticeUrl)}">${escapeHtml(copy.privacy)}</a></p>`
}`;
  return { subject, text, html };
}
