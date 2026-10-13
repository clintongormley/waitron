import { registerAlertMessages, registerAlertWords } from "@waitron/dashboard-kit";
import { ALERT_MESSAGES, ALERT_WORDS } from "./alert-messages.js";

export { alertMessage, hasAlertMessage } from "@waitron/dashboard-kit";

registerAlertMessages(ALERT_MESSAGES);
registerAlertWords(ALERT_WORDS);
