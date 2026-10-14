// In the Amazon S3 rehearsal's processes only: an SDK request sent outside a rehearsal run is refused.
import { installSendGate, setSendGateStrict } from "./aws-send-gate.js";

installSendGate();
setSendGateStrict(true);
