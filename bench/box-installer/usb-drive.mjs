import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createHash, randomFillSync } from "node:crypto";
import { Buffer } from "node:buffer";
import { setTimeout, clearTimeout } from "node:timers";
import { mkdir, open, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hotplugCommands,
  monitorRefused,
  usbBackupName,
  usbImageBytes,
} from "../../scripts/box/usb-drive-rig.mjs";

/** An exFAT image in the run folder holding one backup-named file of random bytes. */
export async function makeUsbDrive(runDir, bytes) {
  const image = join(runDir, "usb-drive.img");
  await writeFile(image, "", { flag: "wx" });
  await truncate(image, usbImageBytes(bytes));
  execFileSync("mkfs.exfat", ["-L", "WAITRONRIG", image], { stdio: "ignore" });
  const mounted = join(runDir, "usb-drive-mount");
  await mkdir(mounted);
  const fileName = usbBackupName(new Date());
  const digest = createHash("sha256");
  execFileSync("mount", ["-t", "exfat", "-o", "loop", image, mounted]);
  try {
    const handle = await open(join(mounted, fileName), "wx");
    try {
      const chunk = Buffer.alloc(16 * 2 ** 20);
      for (let left = bytes; left > 0; left -= chunk.length) {
        const part = chunk.subarray(0, Math.min(left, chunk.length));
        randomFillSync(part);
        digest.update(part);
        await handle.write(part);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  } finally {
    execFileSync("umount", [mounted]);
  }
  return { image, fileName, bytes, sha256: digest.digest("hex") };
}

/** Plugs the image into the running guest through its human monitor; returns the transcript. */
export function hotplug(monitor, image) {
  const commands = hotplugCommands(image);
  return new Promise((done, reject) => {
    const socket = createConnection(monitor);
    let transcript = "";
    let sent = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`usb hot-plug monitor deadline: ${transcript}`));
    }, 15000);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("data", (text) => {
      transcript += text.toString();
      const prompts = transcript.split("(qemu) ").length - 1;
      if (prompts <= sent) return;
      if (sent < commands.length) {
        socket.write(`${commands[sent]}\n`);
        sent += 1;
        return;
      }
      clearTimeout(timer);
      socket.end();
      if (monitorRefused(transcript)) reject(new Error(`usb hot-plug refused: ${transcript}`));
      else done(transcript);
    });
  });
}
