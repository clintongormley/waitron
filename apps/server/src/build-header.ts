import type { MiddlewareHandler } from "hono";
import { BUILD_HEADER } from "@waitron/shared";

export function buildHeaderMiddleware(build: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    // After `next`: a handler that returns its own Response does not inherit headers set before it.
    c.header(BUILD_HEADER, build);
  };
}
