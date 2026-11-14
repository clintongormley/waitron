import { createDiagnosticsLog } from "@waitron/diagnostics";

export const diag = createDiagnosticsLog();

export let reportBuild: string | null = null;
export function setReportBuild(build: string): void {
  reportBuild = build;
}
