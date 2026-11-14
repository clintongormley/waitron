import type { AccessRole } from "../api/client.js";

export const accessRoleChoices: AccessRole[] = [
  { id: "staff", builtInKey: "staff", name: null, permissions: ["payment.take"], holderCount: 0 },
  {
    id: "supervisor",
    builtInKey: "supervisor",
    name: null,
    permissions: ["payment.take", "sale.refund"],
    holderCount: 0,
  },
  {
    id: "manager",
    builtInKey: "manager",
    name: null,
    permissions: ["person.manage", "person.admin"],
    holderCount: 0,
  },
  { id: "admin", builtInKey: "admin", name: null, permissions: [], holderCount: 0 },
];
