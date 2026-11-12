export const WORKFORCE_PERMISSIONS = [
  { permission: "workforce.correct", defaultHolders: ["supervisor", "manager"] },
  { permission: "workforce.self_approve", defaultHolders: [] },
] as const;
