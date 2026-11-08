import addressparser from "nodemailer/lib/addressparser/index.js";
import { normalizeAndValidateEmail } from "@waitron/identity";
import { AppError } from "@waitron/shared";
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
  let address: string;
  try {
    address = normalizeAndValidateEmail(mailbox.address);
  } catch {
    invalid();
  }
  return { name: senderName, address: address! };
}
