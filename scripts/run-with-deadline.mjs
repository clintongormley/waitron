import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { clearTimeout, setTimeout } from "node:timers";

/** The parent owns the deadline: a blocked worker or browser cannot disable this timer.
 * A separate POSIX process group lets cancellation reach workers and browsers as well as pnpm. */
export async function runWithDeadline(
  command,
  args,
  { timeoutMs, graceMs = 5000, stdio = "inherit", signals = process },
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The deadline must be a positive finite number of milliseconds");
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio });
    let result;
    let escalation;
    let closed = false;
    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        /* v8 ignore next -- signalling our own process group can only fail when it has exited. */
        if (error.code !== "ESRCH") throw error;
      }
    };
    const finish = () => {
      clearTimeout(deadline);
      signals.off("SIGINT", interrupt);
      signals.off("SIGTERM", terminate);
      resolve(result);
    };
    const stop = (code) => {
      if (result !== undefined) return;
      result = code;
      clearTimeout(deadline);
      signalGroup("SIGTERM");
      // Keep the escalation even if pnpm exits first: descendants can ignore SIGTERM.
      escalation = setTimeout(() => {
        signalGroup("SIGKILL");
        escalation = undefined;
        if (closed) finish();
      }, graceMs);
    };
    const interrupt = () => stop(130);
    const terminate = () => stop(143);
    signals.on("SIGINT", interrupt);
    signals.on("SIGTERM", terminate);
    const deadline = setTimeout(() => {
      console.error(`Test command exceeded ${timeoutMs / 1000}s: ${command} ${args.join(" ")}`);
      stop(124);
    }, timeoutMs);
    child.once("error", (error) => {
      console.error(`Cannot start test command: ${error.message}`);
      result = 1;
    });
    child.once("close", (code) => {
      closed = true;
      // pnpm can exit on the first failure while another package's workers are still alive.
      if (result === undefined) {
        let survivors = false;
        try {
          process.kill(-child.pid, 0);
          survivors = true;
        } catch {
          // The process group has already exited.
        }
        if (survivors) stop(code ?? 1);
      }
      result ??= code ?? 1;
      if (escalation === undefined) finish();
    });
  });
}

// CLI assertions execute this block in child processes, outside the parent coverage collector.
/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [seconds, separator, command, ...args] = process.argv.slice(2);
  if (separator !== "--" || !command) {
    console.error("Usage: node scripts/run-with-deadline.mjs <seconds> -- <command> [args...]");
    process.exitCode = 1;
  } else {
    process.exitCode = await runWithDeadline(command, args, { timeoutMs: Number(seconds) * 1000 });
  }
}
/* v8 ignore stop */
