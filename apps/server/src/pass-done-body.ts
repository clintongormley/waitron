import { AppError } from "@waitron/shared";
import { isUuid } from "./till-session.js";

export function parsePassDoneBody(body: { ticketItemIds?: unknown; done?: unknown }): {
  ticketItemIds: string[];
  done: boolean;
} {
  const ids = body.ticketItemIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every(isUuid)) {
    throw new AppError("management.request_invalid", { field: "ticketItemIds" });
  }
  if (typeof body.done !== "boolean") {
    throw new AppError("management.request_invalid", { field: "done" });
  }
  return { ticketItemIds: ids, done: body.done };
}
