import { normalizeAndValidateEmail } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import "./errors.js";

export function parseEmailSettings(body: Record<string, unknown>): { url: string; from: string } {
  const invalid = (field: string): never => {
    throw new AppError("email.settings_invalid", { field });
  };
  if (
    typeof body.server !== "string" ||
    !body.server.trim() ||
    /[\s/@?#]/.test(body.server.trim())
  ) {
    invalid("server");
  }
  if (
    typeof body.port !== "number" ||
    !Number.isInteger(body.port) ||
    body.port < 1 ||
    body.port > 65535
  ) {
    invalid("port");
  }
  if (typeof body.encryption !== "string" || !["starttls", "tls"].includes(body.encryption)) {
    invalid("encryption");
  }
  const protocol = body.encryption === "tls" ? "smtps" : "smtp";
  let url: URL;
  try {
    url = new URL(`${protocol}://${(body.server as string).trim()}:${body.port as number}`);
    if (url.hostname !== (body.server as string).trim().toLowerCase()) invalid("server");
  } catch {
    invalid("server");
  }
  const user = body.user === undefined ? "" : body.user;
  const password = body.password === undefined ? "" : body.password;
  if (typeof user !== "string") invalid("user");
  if (typeof password !== "string") invalid("password");
  if (user === "" && password !== "") invalid("user");
  if (user !== "" && password === "") invalid("password");
  url!.username = encodeURIComponent(user as string);
  url!.password = encodeURIComponent(password as string);
  if (body.encryption === "starttls") url!.searchParams.set("requireTLS", "true");
  if (typeof body.from !== "string") invalid("from");
  let from: string;
  try {
    from = normalizeAndValidateEmail(body.from as string);
  } catch {
    invalid("from");
  }
  return { url: url!.href.replace(/\/$/, ""), from: from! };
}
