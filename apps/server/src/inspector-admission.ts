import type { MiddlewareHandler } from "hono";
import { withInspectorAdmitted } from "@waitron/identity";

/** Opens a route to a session holding `invoice.inspect` alone, which `resolveManagementSession`
 * otherwise refuses. Only routes serving the person's own account carry it. */
export const admitsInspector: MiddlewareHandler = (_c, next) => withInspectorAdmitted(next);
