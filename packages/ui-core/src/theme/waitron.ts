import colorsCss from "../tokens/colors.css?raw";
import structureCss from "../tokens/structure.css?raw";
import { readDefaults, type WaitronDefaults } from "./defaults.js";

export const WAITRON_DEFAULTS: WaitronDefaults = readDefaults(colorsCss, structureCss);
