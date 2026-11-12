import { enumType } from "./columns.js";

export const orderStart = enumType(["table", "counter"]);
export const paidWhen = enumType(["prepay", "ticket_then_pay"]);
export const collectionNumber = enumType(["none", "numbered"]);
