import { DINING_POLICIES, DININGS } from "@waitron/shared";
import { enumType } from "./columns.js";

export const orderStart = enumType(["table", "counter"]);
export const paidWhen = enumType(["prepay", "ticket_then_pay"]);
export const collectionNumber = enumType(["none", "numbered"]);
export const diningPolicy = enumType(DINING_POLICIES);
export const dining = enumType(DININGS);
