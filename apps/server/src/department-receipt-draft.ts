import { validateDepartmentReceipt } from "@waitron/layouts";
import {
  AppError,
  isAppError,
  type DepartmentReceiptConfig,
  type DepartmentReceiptWrite,
} from "@waitron/shared";
import type { DepartmentReceiptLanguages } from "./department-receipt-languages.js";
import type { Transaction } from "@waitron/db";
import type { LocationId } from "@waitron/shared";
import { authorizeManager } from "@waitron/identity";
import { departmentReceiptLanguages } from "./department-receipt-languages.js";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function checkedDepartmentReceiptWrite(
  tx: Transaction,
  cfg: { locationId: LocationId },
  departmentId: string,
  managementSessionId: string,
  input: unknown,
  validateOperationDescription?: (description: string) => void,
  options: { touch?: boolean } = {},
) {
  await authorizeManager(tx, {
    managementSessionId,
    permission: "layout.configure",
    touch: options.touch,
  });
  const languages = await departmentReceiptLanguages(tx, cfg);
  const scope = { ...cfg, receiptLanguages: languages.storageLanguages };
  const current = await VENUE_SERVICE.readDepartmentReceipt(tx, scope, departmentId);
  const checked = validateDepartmentReceiptWrite(
    input,
    current,
    languages,
    validateOperationDescription,
  );
  const policy = await VENUE_SERVICE.readDepartmentReceiptPolicy(tx, cfg, departmentId);
  if (
    policy.receiptPrintMode !== checked.policy.receiptPrintMode ||
    policy.printTradingName !== checked.policy.printTradingName
  ) {
    await authorizeManager(tx, {
      managementSessionId,
      permission: "venue_service.manage",
      touch: options.touch,
    });
  }
  return { input: checked, scope };
}

export function validateDepartmentReceiptWrite(
  input: unknown,
  current: DepartmentReceiptConfig,
  languages: DepartmentReceiptLanguages,
  validateOperationDescription?: (description: string) => void,
): DepartmentReceiptWrite {
  if (
    !object(input) ||
    !Object.hasOwn(input, "receipt") ||
    !Object.hasOwn(input, "policy") ||
    Object.keys(input).some((key) => key !== "receipt" && key !== "policy")
  )
    throw new AppError("management.request_invalid", { field: "receipt" });
  const policy = input.policy;
  if (
    !object(policy) ||
    typeof policy.receiptPrintMode !== "string" ||
    !["auto", "on_request"].includes(policy.receiptPrintMode) ||
    typeof policy.printTradingName !== "boolean" ||
    Object.keys(policy).some((key) => key !== "receiptPrintMode" && key !== "printTradingName")
  )
    throw new AppError("management.request_invalid", { field: "policy" });
  const receipt = validateDepartmentReceipt(input.receipt, languages.storageLanguages);
  for (const field of ["headerSubtitle", "footerMessage"] as const) {
    for (const [language, value] of Object.entries(receipt[field] ?? {})) {
      if (!languages.languages.includes(language) && current[field]?.[language] !== value) {
        throw new AppError("receipt.invalid", { reason: "invalid_language", field, language });
      }
    }
  }
  if (validateOperationDescription !== undefined) {
    const description = (input.receipt as Record<string, unknown>).operationDescription;
    if (typeof description !== "string") {
      throw new AppError("management.request_invalid", { field: "operationDescription" });
    }
    try {
      validateOperationDescription(description);
    } catch (error) {
      if (!isAppError(error) || error.code !== "setup.request_invalid") throw error;
      throw new AppError("management.request_invalid", { field: "operationDescription" });
    }
    if (description.trim() === "") {
      throw new AppError("management.request_invalid", { field: "operationDescription" });
    }
  }
  if (validateOperationDescription === undefined && receipt.operationDescription !== undefined) {
    const description = receipt.operationDescription;
    if (
      description.length > 500 ||
      Array.from(description).some((character) => character < " " && !"\t\n\r".includes(character))
    ) {
      throw new AppError("receipt.invalid", {
        field: "operationDescription",
        reason: "invalid_description",
      });
    }
  }
  return {
    receipt,
    policy: {
      receiptPrintMode: policy.receiptPrintMode as "auto" | "on_request",
      printTradingName: policy.printTradingName,
    },
  };
}
