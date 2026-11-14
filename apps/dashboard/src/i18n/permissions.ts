import type { StringKey } from "./strings.js";

export type PermissionArea = "sales" | "reports" | "people" | "venue";
export interface PermissionText {
  area: PermissionArea;
  label: StringKey;
  help?: StringKey;
}
export const PERMISSION_TEXT: Readonly<Record<string, PermissionText>> = {
  "payments.providers.manage": { area: "venue", label: "permission.payments.providers.manage" },
  "payment.take": { area: "sales", label: "permission.payment.take" },
  "sale.void": { area: "sales", label: "permission.sale.void" },
  "sale.refund": { area: "sales", label: "permission.sale.refund" },
  "sale.rectify": { area: "sales", label: "permission.sale.rectify" },
  "cash.drawer": { area: "sales", label: "permission.cash.drawer" },
  "adjustment.apply": { area: "sales", label: "permission.adjustment.apply" },
  "adjustment.approve": { area: "sales", label: "permission.adjustment.approve" },
  "report.view": { area: "reports", label: "permission.report.view" },
  "report.export": { area: "reports", label: "permission.report.export" },
  "fiscal.view": { area: "reports", label: "permission.fiscal.view" },
  "fiscal.remedy": { area: "reports", label: "permission.fiscal.remedy" },
  "personal_data.export": { area: "reports", label: "permission.personal_data.export" },
  "person.manage": { area: "people", label: "permission.person.manage" },
  "person.admin": { area: "people", label: "permission.person.admin" },
  "person.email": { area: "people", label: "permission.person.email" },
  "schedule.manage": { area: "people", label: "permission.schedule.manage" },
  "workforce.correct": { area: "people", label: "permission.workforce.correct" },
  "workforce.self_approve": { area: "people", label: "permission.workforce.self_approve" },
  "catalogue.manage": { area: "venue", label: "permission.catalogue.manage" },
  "venue.view": { area: "venue", label: "permission.venue.view" },
  "venue.configure": { area: "venue", label: "permission.venue.configure" },
  "hardware.manage": { area: "venue", label: "permission.hardware.manage" },
  "purchase.manage": { area: "venue", label: "permission.purchase.manage" },
  "adjustment.manage": { area: "venue", label: "permission.adjustment.manage" },
  "booking.manage": { area: "venue", label: "permission.booking.manage" },
  "system.manage": { area: "venue", label: "permission.system.manage" },
  "system.box_admin": { area: "venue", label: "permission.system.box_admin" },
  "node.manage": { area: "venue", label: "permission.node.manage" },
};
