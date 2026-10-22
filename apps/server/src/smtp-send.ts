import nodemailer, { type SendMailOptions } from "nodemailer";
import { Socket } from "node:net";
import { classifySmtpFailure, type SmtpFailureContext, type SmtpTestCode } from "./smtp-failure.js";

export type SmtpConnection = { url: string; from: string | { name: string; address: string } };
export type SmtpTransport = {
  sendMail(message: SendMailOptions): Promise<unknown>;
  close(): void;
};
export type SmtpSendOutcome =
  { status: "sent" } | { status: "rejected" | "unknown"; reason: SmtpTestCode };

export async function sendSmtpMessage(
  config: SmtpConnection,
  message: Omit<SendMailOptions, "from">,
  options: { timeoutMs?: number; ca?: string; transport?: SmtpTransport } = {},
): Promise<SmtpSendOutcome> {
  const socket = new Socket();
  let transport: SmtpTransport | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let context: SmtpFailureContext = { encryption: "starttls", hasUser: false };
  const failure = (error: unknown): SmtpSendOutcome => {
    const reply =
      typeof error === "object" && error !== null && "responseCode" in error
        ? error.responseCode
        : undefined;
    return {
      status: typeof reply === "number" && reply >= 400 && reply <= 599 ? "rejected" : "unknown",
      reason: classifySmtpFailure(error, context),
    };
  };
  try {
    const url = new URL(config.url);
    if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return failure(undefined);
    const secure = url.protocol === "smtps:";
    context = { encryption: secure ? "tls" : "starttls", hasUser: url.username !== "" };
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    const port = url.port === "" ? (secure ? 465 : 587) : Number(url.port);
    // URL query options must not enable provider logging or weaken certificate checks.
    transport =
      options.transport ??
      nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: url.searchParams.get("requireTLS") === "true",
        ...(context.hasUser
          ? {
              auth: {
                user: decodeURIComponent(url.username),
                pass: decodeURIComponent(url.password),
              },
            }
          : {}),
        // Node owns DNS and dialing so destroying the socket cancels a pending connection.
        getSocket(_options, callback) {
          if (finished) {
            callback(new Error("email.send_timeout"), false);
            return;
          }
          let answered = false;
          const answer = (error: Error | null) => {
            if (answered) return;
            answered = true;
            socket.off("error", onError);
            socket.off("close", onClose);
            callback(error, error === null ? { connection: socket } : false);
          };
          const onError = (error: Error) => answer(error);
          const onClose = () => answer(new Error("email.send_timeout"));
          socket.once("error", onError);
          socket.once("close", onClose);
          socket.connect({ host, port }, () => {
            answer(finished ? new Error("email.send_timeout") : null);
          });
        },
        logger: false,
        debug: false,
        tls: { rejectUnauthorized: true, ...(options.ca === undefined ? {} : { ca: options.ca }) },
      });
    const timeout = new Promise<SmtpSendOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: "unknown", reason: "email.test_timeout" }),
        options.timeoutMs ?? 30_000,
      );
    });
    const sending = transport
      .sendMail({ ...message, from: config.from })
      .then<SmtpSendOutcome, SmtpSendOutcome>(() => ({ status: "sent" }), failure);
    return await Promise.race([sending, timeout]);
  } catch (error) {
    return failure(error);
  } finally {
    finished = true;
    clearTimeout(timer);
    socket.destroy();
    try {
      transport?.close();
    } catch {
      // Cleanup cannot turn a server acceptance into a safe-to-retry refusal.
    }
  }
}
