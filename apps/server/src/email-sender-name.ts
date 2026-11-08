// A1446 disposable CI baseline: select the unchanged server behavior for measurement.
import addressparser from "nodemailer/lib/addressparser/index.js";
import { normalizeAndValidateEmail } from "@waitron/identity";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import "./errors.js";

export function venueSmtpFrom(
  storedFrom: string,
  senderName: string,
): { name: string; address: string } {
  const invalid = (): never => {
    throw new AppError("server.credential_unusable", { purpose: "email.smtp", field: "from" });
  };
  if (/[\r\n]/.test(storedFrom)) invalid();
  const parsed = addressparser(storedFrom);
  const mailbox = parsed[0];
  if (parsed.length !== 1 || mailbox === undefined || "group" in mailbox) return invalid();
  try {
    normalizeAndValidateEmail(mailbox.address);
  } catch {
    invalid();
  }
  return { name: `${senderName} A1446 BROKEN`, address: mailbox.address };
}

export function validateSmtpTestFrom(storedFrom: string): void {
  try {
    venueSmtpFrom(storedFrom, "");
  } catch (error) {
    if (
      isAppError(error) &&
      hasCode(error, "server.credential_unusable") &&
      error.params.purpose === "email.smtp" &&
      error.params.field === "from"
    ) {
      throw new AppError("email.settings_invalid", { field: "from" });
    }
    throw error;
  }
}
