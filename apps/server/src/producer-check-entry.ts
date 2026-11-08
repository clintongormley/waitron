import { ALL_MODULES } from "@waitron/composition";
import { checkFiscalSettings } from "./producer-check.js";

process.exitCode = checkFiscalSettings(ALL_MODULES, console);
