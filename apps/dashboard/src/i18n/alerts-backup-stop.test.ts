import { describe, expect, it } from "vitest";
import { alertMessage } from "./alerts.js";

describe("a backup that stopped before reaching any destination", () => {
  const LEAD_EN =
    "The last backup stopped before reaching any destination, so no new copy was saved. Sales continue.";
  const LEAD_ES =
    "La última copia de seguridad se detuvo antes de llegar a ningún destino, así que no se ha guardado ninguna copia nueva. Las ventas continúan.";

  it("says the box is short of disk space", () => {
    const params = { reason: "backup.staging_space_low" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      `${LEAD_EN} The box does not have enough free disk space to prepare it. Contact support.`,
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} El equipo no tiene espacio libre suficiente en disco para prepararla. Contacta con soporte.`,
    );
  });

  it("says files every backup must include are missing", () => {
    const params = { reason: "recovery.state_incomplete" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      `${LEAD_EN} Some of the box's own files that every backup must include are missing. Contact support.`,
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} Faltan algunos archivos propios del equipo que toda copia debe incluir. Contacta con soporte.`,
    );
  });

  it("sends any other cause to support, never showing the raw code", () => {
    const params = { reason: "unknown" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(`${LEAD_EN} Contact support.`);
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} Contacta con soporte.`,
    );
  });
});
