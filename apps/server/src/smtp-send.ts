import type { SendMailOptions } from "nodemailer";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import MailComposer from "nodemailer/lib/mail-composer";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import { classifySmtpFailure, type SmtpFailureContext, type SmtpTestCode } from "./smtp-failure.js";

export type SmtpConnection = { url: string; from: string | { name: string; address: string } };
export type SmtpTransport = {
  sendMail(message: SendMailOptions): Promise<unknown>;
  close(): void;
};
export type SmtpSendOutcome =
  | { status: "sent" }
  | { status: "rejected"; reason: SmtpTestCode; serverRefused: boolean }
  | { status: "unknown"; reason: SmtpTestCode };

export function statusAsBefore(outcome: SmtpSendOutcome): "sent" | "rejected" | "unknown" {
  return outcome.status === "rejected" && !outcome.serverRefused ? "unknown" : outcome.status;
}

export async function sendSmtpMessage(
  config: SmtpConnection,
  message: Omit<SendMailOptions, "from">,
  options: { timeoutMs?: number; ca?: string; transport?: SmtpTransport } = {},
): Promise<SmtpSendOutcome> {
  const socket = new Socket();
  let connection: SMTPConnection | undefined;
  let stream: Readable | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let handedOver = false;
  let context: SmtpFailureContext = { encryption: "starttls", hasUser: false };
  const failure = (error: unknown, timedOut = false): SmtpSendOutcome => {
    const reply =
      typeof error === "object" && error !== null && "responseCode" in error
        ? error.responseCode
        : undefined;
    const reason = classifySmtpFailure(error, { ...context, timedOut });
    if (typeof reply === "number" && reply >= 400 && reply <= 599) {
      return { status: "rejected", reason, serverRefused: true };
    }
    return handedOver
      ? { status: "unknown", reason }
      : { status: "rejected", reason, serverRefused: false };
  };
  try {
    const url = new URL(config.url);
    if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return failure(undefined);
    const secure = url.protocol === "smtps:";
    context = { encryption: secure ? "tls" : "starttls", hasUser: url.username !== "" };
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    const port = url.port === "" ? (secure ? 465 : 587) : Number(url.port);
    const auth = context.hasUser
      ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
      : undefined;
    const mail = new MailComposer({ ...message, from: config.from }).compile();
    const envelope = mail.getEnvelope();
    if (envelope.to.length !== 1) return failure(undefined);
    const timeout = new Promise<SmtpSendOutcome>((resolve) => {
      timer = setTimeout(() => resolve(failure(undefined, true)), options.timeoutMs ?? 30_000);
    });
    let sending: Promise<SmtpSendOutcome>;
    if (options.transport) {
      handedOver = true;
      sending = options.transport
        .sendMail({ ...message, from: config.from })
        .then<SmtpSendOutcome, SmtpSendOutcome>(() => ({ status: "sent" }), failure);
    } else {
      sending = new Promise<SmtpSendOutcome>((resolve) => {
        socket.once("error", (error) => resolve(failure(error)));
        // Owning the dial prevents a late DNS answer from opening a socket after the deadline.
        socket.connect({ host, port }, () => {
          if (finished) return;
          // URL options cannot enable provider logging or weaken certificate checks.
          connection = new SMTPConnection({
            host,
            port,
            secure,
            requireTLS: url.searchParams.get("requireTLS") === "true",
            connection: socket,
            logger: false,
            debug: false,
            tls: {
              rejectUnauthorized: true,
              ...(options.ca === undefined ? {} : { ca: options.ca }),
            },
          });
          connection.on("error", (error) => resolve(failure(error)));
          connection.on("end", () => setImmediate(() => resolve(failure(undefined))));
          const send = () => {
            // SMTPConnection reads the stream only after the server accepts DATA.
            stream = Readable.from(
              (async function* () {
                handedOver = true;
                yield* mail.createReadStream();
              })(),
              { objectMode: false },
            );
            connection!.send(envelope, stream, (error) =>
              resolve(error ? failure(error) : { status: "sent" }),
            );
          };
          connection.connect(() => {
            if (auth && connection!.allowsAuth) {
              connection!.login(auth, (error) => (error ? resolve(failure(error)) : send()));
            } else send();
          });
        });
      });
    }
    return await Promise.race([sending, timeout]);
  } catch (error) {
    return failure(error);
  } finally {
    finished = true;
    clearTimeout(timer);
    socket.destroy();
    stream?.destroy();
    try {
      connection?.close();
      options.transport?.close();
    } catch {
      // Cleanup cannot turn a server acceptance into a safe-to-retry refusal.
    }
  }
}
