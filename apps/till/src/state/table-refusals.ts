/** Table refusals shown in their code's own words. */
export const TABLE_REFUSALS: ReadonlySet<string> = new Set([
  "device.unauthorized",
  "tab.portions_too_many",
  "fiscal.fingerprint_mismatch",
  "fiscal.chain_handed_over",
  "service_zone.closed",
  "order.payment_in_flight",
  "sale.total_exceeds_simplified_limit",
  "table.not_shared",
  "table.not_joined",
  "table.already_in_party",
  "table.inactive",
  "service_zone.join_mismatch",
  "service_zone.mode_incompatible",
  "group.held_leaves_party",
  "table.needs_clearing",
  "table.needs_moving",
  "table.not_found",
  "table.not_on_today_plan",
  "table.taken_off",
  "table.fixed",
  "table.merged",
  "table.delivery_pending",
  "table.open_delivery_order",
  "tab.already_open",
  "party.not_open",
  "party.bill_outstanding",
  "bill.presented",
  "bill.paid",
  "bill.other_party",
  "bill.received_exceeds_total",
  "bill.refund_in_progress",
  "bill.not_overpaid",
  "bill.overpaid_changed",
  "bill.tip_not_allowed_on_excess",
  "bill.tip_needs_a_sale",
  "working_order.not_open",
  "storage.disk_full",
  "clock.unconfirmed",
  "menu_period.ended",
  "station.no_default",
  "department.operation_description_required",
  "sale.department_missing",
  "order.dining_fixed",
  "order.dining_locked",
  "order.dining_differs",
]);

/** A switch of the way an order sells refused because the stored order has moved on: it is read
 * again, so the screen shows the way it now has. */
export const STORED_WAY_CHANGED: ReadonlySet<string> = new Set([
  "order.dining_locked",
  "order.dining_fixed",
]);

/** A draft save naming a bill that has left its party's open bills: merged away (`tab.not_open`) or
 * moved to another table (`bill.other_party`). */
export const BILL_LEFT_REFUSALS: ReadonlySet<string> = new Set([
  "tab.not_open",
  "bill.other_party",
]);

export const DESTINATION_REFUSALS: ReadonlySet<string> = new Set([
  "order.payment_in_flight",
  "bill.refund_in_progress",
  "bill.presented",
  "bill.paid",
]);

/** A split refused for the state of one of its bills, each named when it is not on screen. */
export const SPLIT_BILL_REFUSALS: ReadonlySet<string> = new Set([
  "bill.received_exceeds_total",
  "bill.refund_in_progress",
  "order.payment_in_flight",
  "working_order.not_open",
  "bill.presented",
  "bill.paid",
]);
