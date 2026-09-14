import { registerAlertMessages } from "@waitron/dashboard-kit";
import { ALERT_MESSAGES } from "./alert-messages.js";

export { alertMessage, hasAlertMessage } from "@waitron/dashboard-kit";

registerAlertMessages(ALERT_MESSAGES);
