import "./errors.js";
import {
  withOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
} from "@waitron/module";
import { AppError } from "@waitron/shared";

// Outside this package's src, eslint.config.js's identity-change zone refuses an import of this file.
const issued = new WeakSet<object>();

export async function withIdentityChangeAuthority<T>(
  binding: OperationBinding,
  release: string,
  run: (authority: OperationAuthority) => Promise<T>,
): Promise<T> {
  if (binding.action !== "identity-change")
    throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
  return withOperationAuthority(binding, `identity-change:${release}`, async (authority) => {
    issued.add(authority);
    try {
      return await run(authority);
    } finally {
      issued.delete(authority);
    }
  });
}

export function isIdentityChangeAuthority(authority: unknown): boolean {
  return typeof authority === "object" && authority !== null && issued.has(authority);
}

/** `identity-change` is admitted under this module's own authority alone, which admits nothing else. */
export function admitsAllocationAction(
  authority: unknown,
  action: string,
  actions: readonly string[],
): boolean {
  return (
    actions.includes(action) &&
    (action === "identity-change") === isIdentityChangeAuthority(authority)
  );
}
