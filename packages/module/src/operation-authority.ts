export interface OperationBinding {
  readonly module: string;
  readonly action: string;
  readonly eventId: string;
  readonly sourceId: string;
  readonly targetNodeId: string;
}

export const OPERATION_BINDING_KEYS = [
  "module",
  "action",
  "eventId",
  "sourceId",
  "targetNodeId",
] as const;

export function isOperationBindingField(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Those five fields and no others, each holding text that is not blank. */
export function isOperationBinding(value: unknown): value is OperationBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return (
    Object.keys(fields).length === OPERATION_BINDING_KEYS.length &&
    OPERATION_BINDING_KEYS.every((key) => isOperationBindingField(fields[key]))
  );
}

declare const operationAuthority: unique symbol;
export interface OperationAuthority {
  readonly [operationAuthority]: true;
}

export interface RecoveryKeyOperator {
  readonly kind: "recovery-key";
  readonly nodeId: string;
  readonly eventId: string;
}

export type OperationOperator = string | RecoveryKeyOperator;

interface VerifiedOperator {
  readonly operatorId: OperationOperator;
}

const issued = new WeakMap<object, { binding: OperationBinding; operator: VerifiedOperator }>();

// The trusted host authenticates the operator before issuance; this carrier performs no login.
export async function withOperationAuthority<T>(
  binding: OperationBinding,
  operatorId: OperationOperator,
  run: (authority: OperationAuthority) => Promise<T>,
): Promise<T> {
  const authority = Object.freeze({}) as OperationAuthority;
  issued.set(authority, {
    binding: Object.freeze({ ...binding }),
    operator: Object.freeze({
      operatorId: typeof operatorId === "string" ? operatorId : Object.freeze({ ...operatorId }),
    }),
  });
  try {
    return await run(authority);
  } finally {
    issued.delete(authority);
  }
}

export function readOperationAuthority(
  authority: unknown,
  binding: OperationBinding,
): VerifiedOperator | undefined {
  if (typeof authority !== "object" || authority === null) return undefined;
  const held = issued.get(authority);
  if (
    held === undefined ||
    held.binding.module !== binding.module ||
    held.binding.action !== binding.action ||
    held.binding.eventId !== binding.eventId ||
    held.binding.sourceId !== binding.sourceId ||
    held.binding.targetNodeId !== binding.targetNodeId
  )
    return undefined;
  return held.operator;
}
