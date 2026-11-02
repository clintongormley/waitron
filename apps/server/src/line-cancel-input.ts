import { ticketState, workingOrderStatus } from "@waitron/db";
import { requireBodyUuid } from "@waitron/server-kit";
import type { CancellationContext } from "./line-cancel-context.js";
import { invalid } from "./bill-allocation.js";

function oneOf<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw invalid(field);
  return value as T;
}

export function parseCancellationContext(raw: unknown): CancellationContext {
  const field = "expectedContext";
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw invalid(field);
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.components) || value.components.length === 0) throw invalid(field);
  const quantity = (value: unknown, nullable = false) => {
    if (nullable && value === null) return null;
    if (typeof value !== "string" || !/^\d{1,12}\.\d{3}$/.test(value)) throw invalid(field);
    return value;
  };
  const components = value.components.map((raw: unknown) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw invalid(field);
    const item = raw as Record<string, unknown>;
    const time = (value: unknown) => {
      if (value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))
        throw invalid(field);
      return value as string | null;
    };
    return {
      id: item.id === null ? null : requireBodyUuid(item.id, field).toLowerCase(),
      lineId: requireBodyUuid(item.lineId, field).toLowerCase(),
      state: item.state === null ? null : oneOf(item.state, ticketState.enumValues, field),
      firedAt: time(item.firedAt),
      requestedAt: time(item.requestedAt),
      stationId:
        item.stationId === null ? null : requireBodyUuid(item.stationId, field).toLowerCase(),
      quantity: quantity(item.quantity)!,
      kitchenQuantity: quantity(item.kitchenQuantity, true),
      servedQuantity: quantity(item.servedQuantity)!,
      cancelledQuantity: quantity(item.cancelledQuantity)!,
    };
  });
  return {
    billStatus: oneOf(value.billStatus, workingOrderStatus.enumValues, field),
    stage: oneOf(value.stage, ["not_started", "started"], field),
    components,
  };
}
