import type { MailKindOwner } from "./mail-sender.js";
import { persons } from "@waitron/db";
import { eq } from "drizzle-orm";
import type { BuiltInRoleKey } from "@waitron/identity";
import { ROLE_MEMBERSHIP_EMAIL_WORDS } from "./i18n/role-membership-email.js";

interface RoleMembershipWords {
  locale: string;
  change: "added" | "removed";
  builtInKey: BuiltInRoleKey | null;
  roleName: string | null;
  editorName: string;
  at: string;
}

export function roleMembershipMail(deps: {
  venueLocale: string;
  readTimeZone(): Promise<string>;
}): MailKindOwner<RoleMembershipWords> {
  return {
    kind: "role_membership_changed",
    deliveryRule: "notice",
    retryDelaysMs: [60000, 120000, 240000, 600000],
    longestWaitMs: 600000,
    async claim(tx, mail) {
      const [person] = await tx
        .select({ email: persons.email, locale: persons.locale })
        .from(persons)
        .where(eq(persons.id, mail.personId!));
      if (person?.email == null) return null;
      return {
        recipient: person.email,
        prepared: {
          locale: person.locale ?? deps.venueLocale,
          change: mail.params.change as RoleMembershipWords["change"],
          builtInKey: mail.params.builtInKey as BuiltInRoleKey | null,
          roleName: mail.params.roleName as string | null,
          editorName: mail.params.editorName as string,
          at: mail.params.at as string,
        },
      };
    },
    async compose(words) {
      const copy = ROLE_MEMBERSHIP_EMAIL_WORDS[words.locale === "es-ES" ? "es" : "en"];
      const role = words.builtInKey === null ? words.roleName! : copy.roles[words.builtInKey];
      const when = new Intl.DateTimeFormat(words.locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: await deps.readTimeZone(),
      }).format(new Date(words.at));
      return {
        subject: copy[words.change].subject(role),
        text: copy[words.change].text(words.editorName, role, when),
      };
    },
    async settle() {},
  };
}
