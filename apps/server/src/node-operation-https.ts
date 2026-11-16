import type { Context } from "hono";
import { isSecure } from "./encrypted-connection.js";
import { AppError } from "@waitron/shared";
import { sentFromThisOrigin } from "./own-page.js";
import "@waitron/module";

export function requireNodeOperationHttps(c: Context): void {
  if (!isSecure(c) || !sentFromThisOrigin(c))
    throw new AppError("node.operation_page_required", {});
}
