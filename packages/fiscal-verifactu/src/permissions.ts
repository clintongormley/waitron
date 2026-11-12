import type { ModulePermission } from "@waitron/module";

export const FISCAL_REMEDY = "fiscal.remedy";

export const FISCAL_PERMISSIONS: readonly ModulePermission[] = [
  { permission: FISCAL_REMEDY, defaultHolders: [] },
];
