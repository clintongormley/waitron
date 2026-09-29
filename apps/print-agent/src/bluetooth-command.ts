import { execFile } from "node:child_process";

export interface BluetoothctlRunOptions {
  /** Kills bluetoothctl after this long; its error then carries `killed: true`. */
  timeoutMs?: number;
}

/** A non-zero exit rejects with the error carrying what was printed as `stdout`, because
 * bluetoothctl reports some outcomes (an address it no longer knows, on `remove`) by exiting 1. */
export function runBluetoothctl(
  args: string[],
  opts: BluetoothctlRunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "bluetoothctl",
      args,
      {
        timeout: opts.timeoutMs ?? 15_000,
        killSignal: "SIGKILL",
        maxBuffer: 1_048_576,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) reject(Object.assign(error, { stdout }));
        else resolve(stdout);
      },
    );
  });
}
