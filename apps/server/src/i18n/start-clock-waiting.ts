import type { SupportedLocale } from "@waitron/shared";

/** The words of the page a restore's start shows while it waits to confirm its time. The key
 * field's are every master-key field's (`@waitron/recovery-pack`'s `MASTER_KEY_FIELD_WORDS`), copied
 * so this module imports only types; the clock step's are the done screen's. */
export const START_CLOCK_WAITING_WORDS: Readonly<
  Record<
    SupportedLocale,
    {
      title: string;
      why: string;
      keyLabel: string;
      /** A wrong key with no name staged for the backup. */
      keyRefused: string;
      /** `{keyName}` stands for the backup's master key's name. */
      wrongKey: string;
      packButton: string;
      notPack: string;
      damaged: string;
      elsewhere: string;
      /** `{heldBy}` stands for the number of the pack holding the master key. */
      elsewhereOn: string;
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
    why: "So that no invoice series is ever repeated, it creates its new series only once its time is confirmed. It carries on by itself once it can check its time over the internet, or once its time is confirmed on the page where the restore was started. If that page is closed, type the master key below to confirm the time from this device.",
    keyLabel: "Master key",
    packButton: "Choose the recovery pack PDF",
    notPack: "This PDF is not a recovery pack.",
    damaged: "This recovery pack PDF is damaged. Type the key.",
    elsewhere:
      "This recovery pack does not hold the master key: choose the pack that holds it, or type the key from it.",
    elsewhereOn:
      "This recovery pack does not hold the master key. It is on recovery pack {heldBy}: choose that pack, or type the key from it.",
    keyRefused: "Enter the selected backup’s master key.",
    wrongKey: "Wrong master key. Use the one dated {keyName}.",
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
    why: "Para que ninguna serie de facturas se repita, solo crea sus series nuevas cuando su hora está confirmada. Sigue sola en cuanto pueda comprobar su hora por internet, o cuando se confirme su hora en la página donde se empezó la restauración. Si esa página está cerrada, escribe abajo la clave maestra para confirmar la hora desde este dispositivo.",
    keyLabel: "Clave maestra",
    packButton: "Elegir el PDF del paquete de recuperación",
    notPack: "Este PDF no es un paquete de recuperación.",
    damaged: "Este PDF del paquete de recuperación está dañado. Escribe la clave.",
    elsewhere:
      "Este paquete de recuperación no tiene la clave maestra: elige el paquete que la tiene o introduce su clave.",
    elsewhereOn:
      "Este paquete de recuperación no tiene la clave maestra. Está en el paquete de recuperación {heldBy}: elige ese paquete o introduce su clave.",
    keyRefused: "Introduce la clave maestra de la copia elegida.",
    wrongKey: "Clave maestra incorrecta. Usa la del {keyName}.",
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
