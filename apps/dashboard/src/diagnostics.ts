import { createDiagnosticsLog } from "@waitron/diagnostics";

// One trail per app session, shared by main.ts (wiring) and the app shell (nav events).
export const diag = createDiagnosticsLog();

export let reportBuild: string | null = null;
export function setReportBuild(build: string): void {
  reportBuild = build;
}
