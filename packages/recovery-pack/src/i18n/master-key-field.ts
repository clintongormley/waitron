import type { PackLocale } from "./pack-words.js";

/** Every master-key field's words; structurally `@waitron/ui`'s `MasterKeyInputCopy`. */
type MasterKeyFieldWords = {
  label: string;
  button: string;
  notPack: string;
  damaged: string;
  notWhole: string;
  wrongKey: (keyName: string) => string;
  elsewhere: (heldBy: number | null) => string;
};

export const MASTER_KEY_FIELD_WORDS: Record<PackLocale, MasterKeyFieldWords> = {
  en: {
    label: "Master key",
    button: "Choose the recovery pack PDF",
    notPack: "This PDF is not a recovery pack.",
    damaged: "This recovery pack PDF is damaged. Type the key or scan it.",
    notWhole: "Not a whole master key. Check it against the recovery pack.",
    wrongKey: (keyName) => `Wrong master key. Use the one dated ${keyName}.`,
    elsewhere: (heldBy) =>
      heldBy === null
        ? "This recovery pack does not hold the master key: choose the pack that holds it, or type the key from it."
        : `This recovery pack does not hold the master key. It is on recovery pack ${heldBy}: choose that pack, or type the key from it.`,
  },
  es: {
    label: "Clave maestra",
    button: "Elegir el PDF del paquete de recuperación",
    notPack: "Este PDF no es un paquete de recuperación.",
    damaged: "Este PDF del paquete de recuperación está dañado. Escribe la clave o escanéala.",
    notWhole: "No es una clave maestra completa. Compárala con el paquete de recuperación.",
    wrongKey: (keyName) => `Clave maestra incorrecta. Usa la del ${keyName}.`,
    elsewhere: (heldBy) =>
      heldBy === null
        ? "Este paquete de recuperación no tiene la clave maestra: elige el paquete que la tiene o introduce su clave."
        : `Este paquete de recuperación no tiene la clave maestra. Está en el paquete de recuperación ${heldBy}: elige ese paquete o introduce su clave.`,
  },
};

/** `damaged` for a field that offers no Scan, such as the restore clock page's. */
export const MASTER_KEY_DAMAGED_NO_SCAN: Record<PackLocale, string> = {
  en: "This recovery pack PDF is damaged. Type the key.",
  es: "Este PDF del paquete de recuperación está dañado. Escribe la clave.",
};
