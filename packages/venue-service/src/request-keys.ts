import { AppError } from "@waitron/shared";
import "./errors.js";

/** Refuses any body key outside `allowed`, so a client cannot choose what the server derives. */
export function onlyKeys(body: object, allowed: readonly string[]): void {
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
}
