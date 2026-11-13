// The real shutdown handlers in their own process, with a close slower than the gaps between
// signals, so a test reads what repeated signals do to a shutdown under way from how this exits.
// `early` asks for a restart before the handlers exist, as a start does when it asks before
// `installShutdownHandlers` has run.
import { installShutdownHandlers, restartProcess } from "../run-server.js";

const [how] = process.argv.slice(2) as ["ask" | "signal" | "early"];

if (how === "early") {
  restartProcess();
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.stdout.write("handlers going in\n");
}

installShutdownHandlers({
  close: async () => {
    process.stdout.write("close started\n");
    await new Promise((resolve) => setTimeout(resolve, how === "early" ? 0 : 1500));
    process.stdout.write("close finished\n");
  },
});

if (how !== "early") {
  const send = how === "ask" ? restartProcess : () => process.kill(process.pid, "SIGTERM");
  send();
  setInterval(send, 100);
}
