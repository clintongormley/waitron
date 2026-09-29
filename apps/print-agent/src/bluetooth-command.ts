import { execFile } from "node:child_process";

export interface BluetoothctlRunOptions {
  /** Kills bluetoothctl after this long; its error then carries `killed: true`. */
  timeoutMs?: number;
}

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
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}
