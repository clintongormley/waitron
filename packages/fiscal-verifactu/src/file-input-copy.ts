import type { FileInputCopy } from "@waitron/ui/src/components/wt-file-input.js";

export const fileInputCopy: Record<"en" | "es", FileInputCopy> = {
  en: {
    drop: "Drop a file here",
    choose: "Choose file",
    replace: "Choose another file",
    previewAlt: "Selected file preview",
  },
  es: {
    drop: "Suelta aquí un archivo",
    choose: "Elegir archivo",
    replace: "Elegir otro archivo",
    previewAlt: "Vista previa del archivo elegido",
  },
};
