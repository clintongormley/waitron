export * from "./casa-delgado-es.js";
export * from "./casa-delgado-ca.js";
export * from "./casa-delgado-valencia.js";
export * from "./menu.js";
export * from "./floor.js";
export * from "./staff.js";
export * from "./reasons.js";
export * from "./developer-presets.js";
export const DEMO_MEDIA_ROOTS: Readonly<Record<string, URL>> = {
  "casa-delgado-valencia": new URL("../../demo-media/casa-delgado-valencia/", import.meta.url),
  "casa-delgado-ca": new URL("../../demo-media/casa-delgado-ca/", import.meta.url),
  "casa-delgado-es": new URL("../../demo-media/casa-delgado-es/", import.meta.url),
};
