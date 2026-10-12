export interface OperationBinding {
  readonly module: string;
  readonly action: string;
  readonly eventId: string;
  readonly sourceId: string;
  readonly targetNodeId: string;
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
