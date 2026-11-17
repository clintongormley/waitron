import { applyTokens, startThemeChoice } from "@waitron/ui";
import { setLocale } from "./i18n/t.js";
import { matchBrowserLocale } from "./i18n/match-browser-locale.js";
import "./screens/emergency-start-screen.js";

applyTokens(document.documentElement);
startThemeChoice(document.documentElement);
const locale = matchBrowserLocale(navigator.languages);
setLocale(locale);
document.documentElement.lang = locale;
document.querySelector("#app")!.append(document.createElement("setup-emergency-start-screen"));
