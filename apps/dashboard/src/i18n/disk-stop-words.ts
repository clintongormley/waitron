import { alertWords, type AlertMessageEntry } from "@waitron/dashboard-kit";

export interface DiskStopDeleted {
  count: number;
  date: string;
  lastDate: string;
  severalDays: boolean;
}

const STOP_EN = "Disk full: the tills cannot save anything (sales, orders, clock-ins).";
const STOP_ES = "Disco lleno: las cajas no pueden guardar nada (ventas, pedidos, fichajes).";
const FREE_EN =
  "Box status can free old logs, old crash reports and what an interrupted backup left.";
const FREE_ES =
  "Estado del equipo puede liberar registros de actividad e informes de fallos antiguos, y lo que dejó una copia interrumpida.";

const WITH_DELETION: AlertMessageEntry = {
  en: `${STOP_EN} The box deleted its {count} oldest backups ({date:date}). ${FREE_EN}`,
  es: `${STOP_ES} El equipo borró sus {count} copias más antiguas ({date:date}). ${FREE_ES}`,
  one: {
    param: "count",
    en: `${STOP_EN} The box deleted its oldest backup ({date:date}). ${FREE_EN}`,
    es: `${STOP_ES} El equipo borró su copia de seguridad más antigua ({date:date}). ${FREE_ES}`,
  },
  variants: {
    severalDays: {
      mode: "replace",
      en: `${STOP_EN} The box deleted its {count} oldest backups ({date:date} to {lastDate:date}). ${FREE_EN}`,
      es: `${STOP_ES} El equipo borró sus {count} copias más antiguas (del {date:date} al {lastDate:date}). ${FREE_ES}`,
    },
  },
};

const WITHOUT_DELETION: AlertMessageEntry = {
  en: `${STOP_EN} ${FREE_EN}`,
  es: `${STOP_ES} ${FREE_ES}`,
};

const WITHOUT_BOX_STATUS: AlertMessageEntry = {
  en: `${STOP_EN} Sign in as a manager to free space on Box status; this signs you out.`,
  es: `${STOP_ES} Inicia sesión como encargado para liberar espacio en Estado del equipo; así se cierra tu sesión.`,
};

export function diskStopMessage(
  deleted: DiskStopDeleted | null,
  canOpenBoxStatus: boolean,
  l?: string,
): string {
  if (!canOpenBoxStatus) return alertWords(WITHOUT_BOX_STATUS, {}, l);
  if (deleted === null) return alertWords(WITHOUT_DELETION, {}, l);
  return alertWords(WITH_DELETION, { ...deleted }, l);
}
