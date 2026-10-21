import { spawn } from "node:child_process";
import { join } from "node:path";
import { VENUE_LOCK_FILE } from "@waitron/store";

/**
 * Starts a second PROCESS holding `venueDir`'s lock the way `lockVenueDirectory` takes it, with no
 * holder file, until the returned `stop` is called (or a 20 s deadline passes). `stop` resolves once
 * the process has exited, so the next case does not find the lock still held. The interval
 * references the connection because a collected one closes and lets the lock go.
 */
export async function holdVenueElsewhere(venueDir: string): Promise<{ stop: () => Promise<void> }> {
  const script = `import { DatabaseSync } from "node:sqlite";
const connection = new DatabaseSync(process.argv[1]);
connection.exec("begin immediate");
process.stdout.write("held");
setInterval(() => connection, 1000);`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, join(venueDir, VENUE_LOCK_FILE)],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
  void exited.then(() => clearTimeout(deadline));
  const stop = () => {
    child.kill("SIGKILL");
    return exited;
  };
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => chunk.toString().includes("held") && resolve());
    child.on("exit", (code) => reject(new Error(`holder exited before holding (${code})`)));
  });
  return { stop };
}
