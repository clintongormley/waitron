import { finishEn, finishEs } from "./strings/finish.js";
import { restoreEn, restoreEs } from "./strings/restore.js";
import { shellEn, shellEs } from "./strings/shell.js";
import { startEn, startEs } from "./strings/start.js";
import { venueEn, venueEs } from "./strings/venue.js";

// English is the source of truth: `StringKey` is derived from `en`'s keys, and `es` is typed
// `Record<StringKey, string>`, so a key added without its Spanish sibling fails typecheck.
export const en = {
  "unsaved.heading": "Discard unsaved changes?",
  "unsaved.message": "Your changes have not been saved.",
  "unsaved.keep": "Keep editing",
  "unsaved.discard": "Discard changes",
  ...shellEn,
  ...startEn,
  ...venueEn,
  ...restoreEn,
  ...finishEn,
} as const;

export type StringKey = keyof typeof en;

export const es: Record<StringKey, string> = {
  "unsaved.heading": "¿Descartar los cambios sin guardar?",
  "unsaved.message": "Tus cambios no se han guardado.",
  "unsaved.keep": "Seguir editando",
  "unsaved.discard": "Descartar cambios",
  ...shellEs,
  ...startEs,
  ...venueEs,
  ...restoreEs,
  ...finishEs,
};

export const catalogues: Record<string, Partial<Record<StringKey, string>>> = {
  "en-GB": en,
  "es-ES": es,
};
