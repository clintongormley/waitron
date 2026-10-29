import { afterEach, describe, expect, it } from "vitest";
import { diskStopMessage, type DiskStopDeleted } from "./disk-stop-words.js";
import { setLocale, t } from "./t.js";

const STOP_EN = "Disk full: the tills cannot save anything (sales, orders, clock-ins).";
const STOP_ES = "Disco lleno: las cajas no pueden guardar nada (ventas, pedidos, fichajes).";
const FREE_EN =
  "Box status can free old logs, old crash reports and what an interrupted backup left.";
const FREE_ES =
  "Estado del equipo puede liberar registros de actividad e informes de fallos antiguos, y lo que dejó una copia interrumpida.";

const one: DiskStopDeleted = {
  count: 1,
  date: "2026-10-28",
  lastDate: "2026-10-28",
  severalDays: false,
};
const sameDay: DiskStopDeleted = {
  count: 3,
  date: "2026-10-28",
  lastDate: "2026-10-28",
  severalDays: false,
};
const severalDays: DiskStopDeleted = {
  count: 3,
  date: "2026-10-21",
  lastDate: "2026-10-24",
  severalDays: true,
};

describe("the full-disk bar's words for someone who can open Box status", () => {
  it("names the one backup the box deleted", () => {
    expect(diskStopMessage(one, true, "en")).toBe(
      `${STOP_EN} The box deleted its oldest backup (28 Oct 2026). ${FREE_EN}`,
    );
    expect(diskStopMessage(one, true, "es")).toBe(
      `${STOP_ES} El equipo borró su copia de seguridad más antigua (28 oct 2026). ${FREE_ES}`,
    );
  });

  it("names how many backups it deleted when they were taken the same day", () => {
    expect(diskStopMessage(sameDay, true, "en")).toBe(
      `${STOP_EN} The box deleted its 3 oldest backups (28 Oct 2026). ${FREE_EN}`,
    );
    expect(diskStopMessage(sameDay, true, "es")).toBe(
      `${STOP_ES} El equipo borró sus 3 copias más antiguas (28 oct 2026). ${FREE_ES}`,
    );
  });

  it("gives the range of days when the backups were taken on different days", () => {
    expect(diskStopMessage(severalDays, true, "en")).toBe(
      `${STOP_EN} The box deleted its 3 oldest backups (21 Oct 2026 to 24 Oct 2026). ${FREE_EN}`,
    );
    expect(diskStopMessage(severalDays, true, "es")).toBe(
      `${STOP_ES} El equipo borró sus 3 copias más antiguas (del 21 oct 2026 al 24 oct 2026). ${FREE_ES}`,
    );
  });

  it("leaves the deletion out when there is none to name", () => {
    expect(diskStopMessage(null, true, "en")).toBe(`${STOP_EN} ${FREE_EN}`);
    expect(diskStopMessage(null, true, "es")).toBe(`${STOP_ES} ${FREE_ES}`);
  });
});

describe("the full-disk bar's words for someone who cannot open Box status", () => {
  const EN = `${STOP_EN} Sign in as a manager to free space on Box status; this signs you out.`;
  const ES = `${STOP_ES} Inicia sesión como encargado para liberar espacio en Estado del equipo; así se cierra tu sesión.`;

  it("offers a manager's sign-in and never names a deletion, even when handed one", () => {
    for (const deleted of [null, one, sameDay, severalDays]) {
      expect(diskStopMessage(deleted, false, "en")).toBe(EN);
      expect(diskStopMessage(deleted, false, "es")).toBe(ES);
    }
  });
});

describe("the full-disk bar's buttons", () => {
  afterEach(() => {
    setLocale("es-ES");
  });

  it("are worded in English and Spanish", () => {
    setLocale("en");
    expect(t("disk_stop.open_box_status")).toBe("Open Box status");
    expect(t("disk_stop.sign_in_as_manager")).toBe("Sign in as a manager");
    setLocale("es-ES");
    expect(t("disk_stop.open_box_status")).toBe("Abrir Estado del equipo");
    expect(t("disk_stop.sign_in_as_manager")).toBe("Iniciar sesión como encargado");
  });
});
