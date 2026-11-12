import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, closeSync, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { isMainScript } from "./is-main-script.mjs";

const wrapper = fileURLToPath(new URL("./run-with-deadline.mjs", import.meta.url));

export async function repeatTest({ count, seconds, command, load, signals = process }) {
  const directory = mkdtempSync(join(tmpdir(), "waitron-repeat-"));
  console.log(`Evidence: ${directory}`);
  let failed = false;
  let cancelled = 0;
  let finishing = false;
  let invalid = false;
  let active;
  const start = (args, log, limit) => {
    appendFileSync(log, `Command: ${JSON.stringify(args)}\n`);
    const fd = openSync(log, "a");
    const child = spawn(
      process.execPath,
      [wrapper, String(limit), "--diagnostics", "--", ...args],
      { stdio: ["ignore", fd, fd] },
    );
    closeSync(fd);
    return { child, done: once(child, "close") };
  };
  const background = load && start(load, join(directory, "load.log"), seconds * (count + 1) + 10);
  background?.done.then(([code]) => {
    if (!finishing && !cancelled) {
      invalid = true;
      appendFileSync(
        join(directory, "load.log"),
        `Invalid experiment: load exited early (${code})\n`,
      );
      active?.child.kill("SIGTERM");
    }
  });
  const stop = (code) => {
    cancelled = code;
    active?.child.kill("SIGTERM");
    background?.child.kill("SIGTERM");
  };
  const interrupt = () => stop(130);
  const terminate = () => stop(143);
  signals.on("SIGINT", interrupt);
  signals.on("SIGTERM", terminate);
  try {
    for (let attempt = 1; attempt <= count && !cancelled && !invalid; attempt++) {
      const log = join(directory, `attempt-${attempt}.log`);
      active = start(command, log, seconds);
      const [code] = await active.done;
      active = undefined;
      appendFileSync(log, `Exit: ${code}\n`);
      if (code !== 0) {
        failed = true;
        const snapshot = spawnSync("ps", ["-axo", "pid,ppid,stat,etime,pcpu,rss,args"], {
          encoding: "utf8",
          timeout: 2000,
          maxBuffer: 2 * 1024 * 1024,
        });
        appendFileSync(log, `Process snapshot (after exit):\n${snapshot.stdout}${snapshot.stderr}`);
      }
    }
  } finally {
    finishing = true;
    background?.child.kill("SIGTERM");
    if (background) await background.done;
    signals.off("SIGINT", interrupt);
    signals.off("SIGTERM", terminate);
  }
  return { code: cancelled || (failed || invalid ? 1 : 0), directory };
}

/* v8 ignore start -- CLI exercised in child processes; the exported loop is measured in-process. */
if (isMainScript(import.meta.url)) {
  const [count, seconds, ...args] = process.argv.slice(2);
  const separator = args.indexOf("--");
  const load = separator > 0 && args[0] === "--load" ? args.slice(1, separator) : undefined;
  const command = args.slice(separator + 1);
  if (
    !Number.isInteger(Number(count)) ||
    Number(count) <= 0 ||
    !Number.isFinite(Number(seconds)) ||
    Number(seconds) <= 0 ||
    separator < 0 ||
    !command.length ||
    (separator > 0 && !load?.length)
  ) {
    console.error(
      "Usage: node scripts/repeat-test.mjs <count> <seconds> [--load <command> [args...]] -- <test-command> [args...]",
    );
    process.exitCode = 1;
  } else {
    process.exitCode = (
      await repeatTest({ count: Number(count), seconds: Number(seconds), command, load })
    ).code;
  }
}
/* v8 ignore stop */
