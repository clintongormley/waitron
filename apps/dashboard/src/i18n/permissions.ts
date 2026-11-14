import type { StringKey } from "./strings.js";

export type PermissionArea = "sales" | "reports" | "people" | "venue";
export interface PermissionText {
  area: PermissionArea;
  label: StringKey;
  help?: StringKey;
}
export const PERMISSION_TEXT: Readonly<Record<string, PermissionText>> = {
  "payments.providers.manage": {
    area: "venue",
    label: "permission.payments.providers.manage",
    help: "permission.payments.providers.manage.help",
  },
  "payment.take": {
    area: "sales",
    label: "permission.payment.take",
    help: "permission.payment.take.help",
  },
  "sale.void": { area: "sales", label: "permission.sale.void", help: "permission.sale.void.help" },
  "sale.refund": {
    area: "sales",
    label: "permission.sale.refund",
    help: "permission.sale.refund.help",
  },
  "sale.rectify": {
    area: "sales",
    label: "permission.sale.rectify",
    help: "permission.sale.rectify.help",
  },
  "cash.drawer": {
    area: "sales",
    label: "permission.cash.drawer",
    help: "permission.cash.drawer.help",
  },
  "adjustment.apply": {
    area: "sales",
    label: "permission.adjustment.apply",
    help: "permission.adjustment.apply.help",
  },
  "adjustment.approve": {
    area: "sales",
    label: "permission.adjustment.approve",
    help: "permission.adjustment.approve.help",
  },
  "report.view": {
    area: "reports",
    label: "permission.report.view",
    help: "permission.report.view.help",
  },
  "report.export": {
    area: "reports",
    label: "permission.report.export",
    help: "permission.report.export.help",
  },
  "fiscal.view": {
    area: "reports",
    label: "permission.fiscal.view",
    help: "permission.fiscal.view.help",
  },
  "fiscal.remedy": {
    area: "reports",
    label: "permission.fiscal.remedy",
    help: "permission.fiscal.remedy.help",
  },
  "personal_data.export": {
    area: "reports",
    label: "permission.personal_data.export",
    help: "permission.personal_data.export.help",
  },
  "person.manage": {
    area: "people",
    label: "permission.person.manage",
    help: "permission.person.manage.help",
  },
  "person.admin": {
    area: "people",
    label: "permission.person.admin",
    help: "permission.person.admin.help",
  },
  "person.email": {
    area: "people",
    label: "permission.person.email",
    help: "permission.person.email.help",
  },
  "schedule.manage": {
    area: "people",
    label: "permission.schedule.manage",
    help: "permission.schedule.manage.help",
  },
  "workforce.correct": {
    area: "people",
    label: "permission.workforce.correct",
    help: "permission.workforce.correct.help",
  },
  "workforce.self_approve": {
    area: "people",
    label: "permission.workforce.self_approve",
    help: "permission.workforce.self_approve.help",
  },
  "catalogue.manage": {
    area: "venue",
    label: "permission.catalogue.manage",
    help: "permission.catalogue.manage.help",
  },
  "venue.view": {
    area: "venue",
    label: "permission.venue.view",
    help: "permission.venue.view.help",
  },
  "venue.configure": {
    area: "venue",
    label: "permission.venue.configure",
    help: "permission.venue.configure.help",
  },
  "hardware.manage": {
    area: "venue",
    label: "permission.hardware.manage",
    help: "permission.hardware.manage.help",
  },
  "purchase.manage": {
    area: "venue",
    label: "permission.purchase.manage",
    help: "permission.purchase.manage.help",
  },
  "adjustment.manage": {
    area: "venue",
    label: "permission.adjustment.manage",
    help: "permission.adjustment.manage.help",
  },
  "booking.manage": {
    area: "venue",
    label: "permission.booking.manage",
    help: "permission.booking.manage.help",
  },
  "system.manage": {
    area: "venue",
    label: "permission.system.manage",
    help: "permission.system.manage.help",
  },
  "system.box_admin": {
    area: "venue",
    label: "permission.system.box_admin",
    help: "permission.system.box_admin.help",
  },
  "node.manage": {
    area: "venue",
    label: "permission.node.manage",
    help: "permission.node.manage.help",
  },
};
