import type { KeyRing } from "@waitron/credentials";
import {
  issueQueuedAccountAction,
  readPersonAccessRoles,
  type AccountMailParams,
  type IssuedAccountAction,
} from "@waitron/identity";
import { composeAccountEmail, type AccountEmail } from "./account-email.js";
import type { MailKindOwner } from "./mail-sender.js";

export function accountActionMail(deps: {
  keyRing?: KeyRing;
  emailChangeUrl: string;
  venueLocale: string;
  readTimeZone: () => Promise<string>;
  readPrivacyNoticeUrl: () => Promise<string | null>;
}): MailKindOwner<{
  issued: IssuedAccountAction;
  origin?: string;
  roles?: AccountEmail["roles"];
}> {
  return {
    kind: "account_action",
    deliveryRule: "notice",
    retryDelaysMs: [60000, 120000, 240000, 600000],
    longestWaitMs: 600000,
    async claim(tx, mail, now) {
      const params = mail.params as AccountMailParams;
      const issued = await issueQueuedAccountAction(
        tx,
        { personId: mail.personId!, params },
        { keyRing: deps.keyRing, now },
      );
      if (issued === null) return null;
      const roles =
        issued.purpose === "invitation"
          ? await readPersonAccessRoles(tx, mail.personId!, issued.locale ?? deps.venueLocale)
          : undefined;
      return { recipient: issued.email, prepared: { issued, origin: params.origin, roles } };
    },
    async compose({ issued, origin, roles }) {
      let actionUrl = deps.emailChangeUrl;
      if (issued.purpose !== "email_change") {
        const url = new URL("/account", origin ?? deps.emailChangeUrl);
        url.searchParams.set("token", issued.token);
        url.searchParams.set("purpose", issued.purpose);
        url.hash = new URLSearchParams({ email: issued.email }).toString();
        actionUrl = url.toString();
      }
      const timeZone = await deps.readTimeZone();
      const privacyNoticeUrl = await deps.readPrivacyNoticeUrl();
      const composed = composeAccountEmail(
        { ...issued, actionUrl, locale: issued.locale ?? deps.venueLocale, roles },
        { timeZone, ...(privacyNoticeUrl === null ? {} : { privacyNoticeUrl }) },
      );
      return {
        ...composed,
        accountEmail: {
          class: issued.purpose,
          recipient: issued.email,
          displayName: issued.displayName,
          locale: (issued.locale ?? deps.venueLocale).startsWith("es") ? "es-ES" : "en-GB",
          timeZone,
          expiresAt: issued.expiresAt,
          ...(issued.purpose === "email_change"
            ? { code: issued.code!, codeExpiresAt: issued.codeExpiresAt! }
            : { token: issued.token }),
        },
      };
    },
    async settle() {},
  };
}
