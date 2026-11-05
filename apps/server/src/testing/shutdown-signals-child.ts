// The real shutdown handlers in their own process, with a close slower than the gaps between
// signals, so a test reads what repeated signals do to a shutdown under way from how this exits.
import { installShutdownHandlers, restartProcess } from "../run-server.js";

const [how] = process.argv.slice(2) as ["ask" | "signal"];

installShutdownHandlers({
  close: async () => {
    process.stdout.write("close started\n");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    process.stdout.write("close finished\n");
  },
});

const send = how === "ask" ? restartProcess : () => process.kill(process.pid, "SIGTERM");
send();
setInterval(send, 100);
