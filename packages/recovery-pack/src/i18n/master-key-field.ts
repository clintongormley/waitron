import type { PackLocale } from "./pack-words.js";

/** Every master-key field's words; structurally `@waitron/ui`'s `MasterKeyInputCopy`. */
type MasterKeyFieldWords = {
  label: string;
  button: string;
  /** The show/hide button's names, and what is said once it is pressed. */
  visibility: { show: string; hide: string; shown: string; hidden: string };
  /** Said to screen readers once a chosen PDF or a scan filled the field; never the key itself. */
  loaded: string;
  notPack: string;
  damaged: string;
  damagedNoScan: string;
  notWhole: string;
  wrongKey: (keyName: string) => string;
  elsewhere: (heldBy: number | null) => string;
  scan: string;
  scanning: string;
  notKeyCode: string;
  cameraFailed: string;
  camera: string;
  stopScan: string;
};

export const MASTER_KEY_FIELD_WORDS: Record<PackLocale, MasterKeyFieldWords> = {
  en: {
    label: "Master key",
    button: "Choose the recovery pack PDF",
    visibility: {
      show: "Show key",
      hide: "Hide key",
      shown: "Key shown",
      hidden: "Key hidden",
    },
    loaded: "Key loaded",
    notPack: "This PDF is not a recovery pack.",
    damaged: "This recovery pack PDF is damaged. Type the key or scan it.",
    damagedNoScan: "This recovery pack PDF is damaged. Type the key.",
    notWhole: "Not a whole master key. Check it against the recovery pack.",
    wrongKey: (keyName) => `Wrong master key. Use the one dated ${keyName}.`,
    elsewhere: (heldBy) =>
      heldBy === null
        ? "This recovery pack does not hold the master key: choose the pack that holds it, or type the key from it."
        : `This recovery pack does not hold the master key. It is on recovery pack ${heldBy}: choose that pack, or type the key from it.`,
    scan: "Scan the recovery pack",
    scanning: "Hold the master key's QR code up to the camera.",
    notKeyCode: "That is not the master key's QR code.",
    cameraFailed: "The camera is not available. Type the key or choose the PDF.",
    camera: "Camera",
    stopScan: "Stop scanning",
  },
  es: {
    label: "Clave maestra",
    button: "Elegir el PDF del paquete de recuperación",
    visibility: {
      show: "Mostrar clave",
      hide: "Ocultar clave",
      shown: "Clave visible",
      hidden: "Clave oculta",
    },
    loaded: "Clave cargada",
    notPack: "Este PDF no es un paquete de recuperación.",
    damaged: "Este PDF del paquete de recuperación está dañado. Escribe la clave o escanéala.",
    damagedNoScan: "Este PDF del paquete de recuperación está dañado. Escribe la clave.",
    notWhole: "No es una clave maestra completa. Compárala con el paquete de recuperación.",
    wrongKey: (keyName) => `Clave maestra incorrecta. Usa la del ${keyName}.`,
    elsewhere: (heldBy) =>
      heldBy === null
        ? "Este paquete de recuperación no tiene la clave maestra: elige el paquete que la tiene o introduce su clave."
        : `Este paquete de recuperación no tiene la clave maestra. Está en el paquete de recuperación ${heldBy}: elige ese paquete o introduce su clave.`,
    scan: "Escanear el paquete de recuperación",
    scanning: "Pon el código QR de la clave maestra delante de la cámara.",
    notKeyCode: "Ese no es el código QR de la clave maestra.",
    cameraFailed: "La cámara no está disponible. Escribe la clave o elige el PDF.",
    camera: "Cámara",
    stopScan: "Dejar de escanear",
  },
};
