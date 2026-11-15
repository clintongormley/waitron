import { DINING_POLICIES, DININGS, type Dining, type DiningPolicy } from "@waitron/shared";
import { enumType } from "./columns.js";

export { DINING_POLICIES, DININGS, type Dining, type DiningPolicy };

export const orderStart = enumType(["table", "counter"]);
export const paidWhen = enumType(["prepay", "ticket_then_pay"]);
export const collectionNumber = enumType(["none", "numbered"]);
export const diningPolicy = enumType(DINING_POLICIES);
export const dining = enumType(DININGS);
