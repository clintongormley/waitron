import nodemailer from "nodemailer";
import { Socket } from "node:net";

export type AttendanceMailOutcome = "sent" | "rejected" | "unknown";
export type AttendanceEmailSender = (message: {
  smtp: { url: string; from: string };
  recipient: string;
  locale: "en" | "es";
  businessDay: string;
  locationName: string;
  missingKinds: readonly ("in" | "out")[];
}) => Promise<AttendanceMailOutcome>;

export function createAttendanceEmailSender(): AttendanceEmailSender {
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
    const socket = new Socket();
    const transport = nodemailer.createTransport({ url: smtp.url, socket });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<AttendanceMailOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve("unknown");
        socket.destroy();
        transport.close();
      }, 30_000);
    });
    try {
      const sending = transport
        .sendMail({
          from: smtp.from,
          to: recipient,
          subject:
            locale === "es"
              ? `Fichajes pendientes: ${businessDay}`
              : `Missing clock times: ${businessDay}`,
          text:
            locale === "es"
              ? `El ${businessDay}, en ${locationName}, faltó ${missing}. Corrige las horas en tu próximo fichaje de entrada.`
              : `On ${businessDay} at ${locationName}, you did not ${missing}. Fix your hours at your next clock-in.`,
        })
        .then<AttendanceMailOutcome, AttendanceMailOutcome>(
          () => "sent",
          (error: unknown) => {
            const code =
              typeof error === "object" && error !== null && "responseCode" in error
                ? error.responseCode
                : undefined;
            return typeof code === "number" && code >= 400 && code <= 599 ? "rejected" : "unknown";
          },
        );
      return await Promise.race([sending, timeout]);
    } finally {
      clearTimeout(timer!);
      socket.destroy();
      transport.close();
    }
  };
}
