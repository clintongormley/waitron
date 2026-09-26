import { execFile } from "node:child_process";

export function runBluetoothctl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "bluetoothctl",
      args,
      {
        timeout: 15_000,
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
