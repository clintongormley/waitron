import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const waits = process.argv.slice(2).map((id) => execute("docker", ["wait", id]));
const stop = () => {
  for (const wait of waits) wait.child.kill("SIGTERM");
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  if (waits.length > 0) await Promise.race(waits);
} catch (error) {
  process.stderr.write(String(error.message) + "\n");
} finally {
  stop();
  await Promise.allSettled(waits);
}
