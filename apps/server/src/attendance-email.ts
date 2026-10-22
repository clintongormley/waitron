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
    const missing =
      locale === "es"
        ? missingKinds.length === 2
          ? "fichar la entrada o la salida"
          : missingKinds[0] === "in"
            ? "fichar la entrada"
            : "fichar la salida"
        : missingKinds.length === 2
          ? "clock in or out"
          : missingKinds[0] === "in"
            ? "clock in"
            : "clock out";
    const outcome = await sendSmtpMessage(smtp, {
      to: recipient,
      subject:
        locale === "es"
          ? `Fichajes pendientes: ${businessDay}`
          : `Missing clock times: ${businessDay}`,
      text:
        locale === "es"
          ? `El ${businessDay}, en ${locationName}, faltó ${missing}. Corrige las horas en tu próximo fichaje de entrada.`
          : `On ${businessDay} at ${locationName}, you did not ${missing}. Fix your hours at your next clock-in.`,
    });
    if (outcome.status !== "sent") options.onFailure?.(outcome.reason);
    return outcome.status;
  };
}
