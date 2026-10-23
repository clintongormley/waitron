import { spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import { clearTimeout, setTimeout } from "node:timers";

export function createDeadlineDiagnostics({
  write = (line) => console.error(line),
  snapshot = () =>
    spawnSync("ps", ["-axo", "pid,ppid,stat,etime,pcpu,rss,args"], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 2 * 1024 * 1024,
    }),
} = {}) {
  const running = new Set();
  const streams = new Map();
  const readLine = (line) => {
    const start = /^\[file-progress\] start (.+)$/.exec(line);
    if (start) running.add(start[1]);
    for (const name of running) {
      if (line.startsWith(`[file-progress] end ${name} `)) running.delete(name);
    }
  };
  return {
    observe(chunk, channel) {
      let stream = streams.get(channel);
      if (!stream) {
        stream = { decoder: new StringDecoder("utf8"), pending: "" };
        streams.set(channel, stream);
      }
      const lines = (stream.pending + stream.decoder.write(chunk)).split(/\r?\n/);
      stream.pending = lines.pop().slice(-65536);
      for (const line of lines) readLine(line);
    },
    report() {
      for (const stream of streams.values()) readLine(stream.pending + stream.decoder.end());
      write("Unfinished test files:");
      if (running.size === 0)
        write("  No unfinished file reported; startup or teardown may be stalled.");
      for (const name of running) write(`  ${name}`);
      write("Files are assigned to workers; a browser may still be loading them.");
      write("Process snapshot (pid, ppid, state, elapsed, cpu, rss, command):");
      const result = snapshot();
      if (result.stdout) write(result.stdout);
      if (result.stderr) write(result.stderr);
      if (result.status !== 0)
        write(`Process snapshot failed: ${result.error?.message ?? result.status}`);
    },
  };
}

/** The parent owns the deadline: a blocked worker or browser cannot disable this timer.
 * A separate POSIX process group lets cancellation reach workers and browsers as well as pnpm. */
export async function runWithDeadline(
  command,
  args,
  { timeoutMs, graceMs = 5000, stdio = "inherit", signals = process, diagnostics = false },
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The deadline must be a positive finite number of milliseconds");
  }
  return new Promise((resolve) => {
    const report = diagnostics ? createDeadlineDiagnostics() : undefined;
    const child = spawn(command, args, {
      detached: true,
      stdio: diagnostics ? ["inherit", "pipe", "pipe"] : stdio,
    });
    if (report) {
      for (const channel of ["stdout", "stderr"]) {
        child[channel].on("data", (chunk) => report.observe(chunk, channel));
        child[channel].pipe(process[channel]);
      }
    }
    let result;
    let escalation;
    let closed = false;
    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        /* v8 ignore start -- signalling our own process group can only fail when it has exited. */
        if (error.code !== "ESRCH") throw error;
        /* v8 ignore stop */
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
      console.error(`Command exceeded ${timeoutMs / 1000}s: ${command} ${args.join(" ")}`);
      report?.report();
      stop(124);
    }, timeoutMs);
    child.once("error", (error) => {
      console.error(`Cannot start command: ${error.message}`);
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
  const [seconds, ...rest] = process.argv.slice(2);
  const diagnostics = rest[0] === "--diagnostics";
  if (diagnostics) rest.shift();
  const [separator, command, ...args] = rest;
  if (separator !== "--" || !command) {
    console.error(
      "Usage: node scripts/run-with-deadline.mjs <seconds> [--diagnostics] -- <command> [args...]",
    );
    process.exitCode = 1;
  } else {
    process.exitCode = await runWithDeadline(command, args, {
      timeoutMs: Number(seconds) * 1000,
      diagnostics,
    });
  }
}
/* v8 ignore stop */
