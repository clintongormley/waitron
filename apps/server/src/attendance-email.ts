import { ATTENDANCE_EMAIL_WORDS } from "./i18n/attendance-email.js";
import { sendSmtpMessage, type SmtpConnection } from "./smtp-send.js";
import type { SmtpTestCode } from "./smtp-failure.js";

export type AttendanceMailOutcome = "sent" | "rejected" | "unknown";
export type AttendanceEmailSender = (message: {
  smtp: SmtpConnection;
  recipient: string;
  locale: "en" | "es";
  businessDay: string;
  locationName: string;
  missingKinds: readonly ("in" | "out")[];
}) => Promise<AttendanceMailOutcome>;

export function createAttendanceEmailSender(
  options: { onFailure?: (reason: SmtpTestCode) => void } = {},
): AttendanceEmailSender {
  return async ({ smtp, recipient, locale, businessDay, locationName, missingKinds }) => {
    const copy = locale === "es" ? ATTENDANCE_EMAIL_WORDS.es : ATTENDANCE_EMAIL_WORDS.en;
    const missing =
      missingKinds.length === 2
        ? copy.missingBoth
        : missingKinds[0] === "in"
          ? copy.missingIn
          : copy.missingOut;
    const outcome = await sendSmtpMessage(smtp, {
      to: recipient,
      subject: copy.subject(businessDay),
      text: copy.text(businessDay, locationName, missing),
    });
    if (outcome.status !== "sent") {
      try {
        options.onFailure?.(outcome.reason);
      } catch {
        // Diagnostics must not change whether a worker may retry this message.
      }
    }
    return outcome.status;
  };
}
