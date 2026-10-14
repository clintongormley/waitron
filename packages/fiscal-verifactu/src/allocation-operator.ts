import type { OperationOperator } from "@waitron/module";

function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

export function parseAllocationOperator(value: unknown): OperationOperator | null {
  if (text(value)) return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 3 ||
    !["kind", "nodeId", "eventId"].every((key) => Object.hasOwn(input, key)) ||
    input.kind !== "recovery-key" ||
    !text(input.nodeId) ||
    !text(input.eventId)
  )
    return null;
  return Object.freeze({ kind: "recovery-key", nodeId: input.nodeId, eventId: input.eventId });
}
