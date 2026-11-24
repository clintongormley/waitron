import type { SupportedLocale } from "@waitron/shared";

/** The words of the page a restore's start shows while it waits to confirm its time. The key
 * field's label and refusal are the restore page's (`apps/setup` `restore.allocation_node_key`,
 * `restore.allocation_key_missing`); the clock step's are the done screen's. */
export const START_CLOCK_WAITING_WORDS: Readonly<
  Record<
    SupportedLocale,
    {
      title: string;
      why: string;
      keyLabel: string;
      keyRefused: string;
      keyContinue: string;
      waitingForClock: string;
      deviceTime: string;
      serverTime: string;
      confirm: string;
      thisDevice: string;
      confirmed: string;
      onBox: string;
      setRefused: string;
    }
  >
> = {
  "en-GB": {
    title: "The box is restoring your backup and is waiting to confirm its time.",
    why: "So that no invoice series is ever repeated, it creates its new series only once its time is confirmed. It carries on by itself once it can check its time over the internet, or once its time is confirmed on the page where the restore was started. If that page is closed, enter the backup's master key below to confirm the time from this device.",
    keyLabel: "Selected backup’s box key",
    keyRefused: "Enter the selected backup’s master key.",
    keyContinue: "Continue",
    waitingForClock:
      "Before it creates the new invoice series, the box needs you to confirm its time again. Check that both times below are right, then press Confirm the time. If the box's time is wrong, press This device to set it from this device's time.",
    deviceTime: "This device's time:",
    serverTime: "The box's time:",
    confirm: "Confirm the time",
    thisDevice: "This device",
    confirmed: "Time confirmed. The box carries on with the restore by itself.",
    onBox:
      "This screen is on the box itself, so its time does not count. Open this page on a phone, computer or till on the venue's network.",
    setRefused:
      "The box could not set its clock from this device. Check this device's date and time, then press This device again.",
  },
  "es-ES": {
    title: "El servidor está restaurando tu copia y espera a confirmar su hora.",
    why: "Para que ninguna serie de facturas se repita, solo crea sus series nuevas cuando su hora está confirmada. Sigue sola en cuanto pueda comprobar su hora por internet, o cuando se confirme su hora en la página donde se empezó la restauración. Si esa página está cerrada, introduce abajo la clave maestra de la copia para confirmar la hora desde este dispositivo.",
    keyLabel: "Clave del servidor de la copia elegida",
    keyRefused: "Introduce la clave maestra de la copia elegida.",
    keyContinue: "Continuar",
    waitingForClock:
      "Antes de crear las series de facturas nuevas, el servidor necesita que vuelvas a confirmar su hora. Comprueba que las dos horas de abajo son correctas y pulsa Confirmar la hora. Si la hora del servidor está mal, pulsa Este dispositivo para ponerla con la hora de este dispositivo.",
    deviceTime: "Hora de este dispositivo:",
    serverTime: "Hora del servidor:",
    confirm: "Confirmar la hora",
    thisDevice: "Este dispositivo",
    confirmed: "Hora confirmada. El servidor sigue solo con la restauración.",
    onBox:
      "Esta pantalla está en el propio servidor, así que su hora no cuenta. Abre esta página en un móvil, ordenador o caja de la red del local.",
    setRefused:
      "El servidor no ha podido ponerse en hora con este dispositivo. Comprueba la fecha y la hora de este dispositivo y vuelve a pulsar Este dispositivo.",
  },
};
