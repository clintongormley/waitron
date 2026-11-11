import process from "node:process";
import console from "node:console";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { installerNameNotice } from "./installer-name-notice.mjs";
import { INSTALLER_TIMINGS_MS } from "./installer-policy.mjs";
import { formatInstallerNotice, INSTALLER_MESSAGES, INSTALLER_WORDS } from "./i18n/installer.mjs";

const loader = "\\EFI\\BOOT\\BOOTX64.EFI";
const failed = INSTALLER_WORDS.en.failed;
const firmwareCommand = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    timeout: 12000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });

async function waitForReturn(input, output, notice) {
  await new Promise((done) => {
    let timer;
    const wasRaw = input?.isRaw === true;
    let raw = false;
    let interrupted = false;
    const detach = () => {
      input?.removeListener("data", typed);
      input?.removeListener("end", unavailable);
      input?.removeListener("error", unavailable);
      if (raw) {
        try {
          input.setRawMode(wasRaw);
        } catch {
          /* A disconnected terminal may refuse restoration. */
        }
        raw = false;
      }
      input?.pause();
    };
    const arm = (ms) => {
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => {
        detach();
        done();
      }, ms);
    };
    const typed = (bytes) => {
      if (bytes.length === 0) return;
      if (!interrupted) {
        interrupted = true;
        output.write(INSTALLER_MESSAGES.paused);
      }
      arm(INSTALLER_TIMINGS_MS.reinstallIdle);
    };
    const unavailable = () => {
      detach();
      output.write(INSTALLER_MESSAGES.keysUnavailable);
    };
    let available = false;
    try {
      if (input?.isTTY && !input.readableEnded && !input.destroyed) {
        input.setRawMode(true);
        raw = true;
        available = true;
      }
    } catch {
      /* The automatic return remains available without a keyboard. */
    }
    output.write(`${formatInstallerNotice(notice)}\n${INSTALLER_MESSAGES.countdown}`);
    arm(INSTALLER_TIMINGS_MS.waitronStart);
    if (!available) {
      unavailable();
      return;
    }
    input.on("end", unavailable);
    input.on("error", unavailable);
    input.on("data", typed);
    input.resume();
  });
}

export async function installerReturn(
  target,
  { input = process.stdin, output = process.stdout, run = firmwareCommand } = {},
) {
  const notice = await installerNameNotice(target);
  if (notice === null) throw new Error("install.refused:occupied");
  await waitForReturn(input, output, notice);
  try {
    const table = JSON.parse(await run("sfdisk", ["--json", target])).partitiontable;
    const esp = table?.partitions?.[0];
    if (
      table?.label !== "gpt" ||
      esp?.node !== `${target}1` ||
      esp?.type?.toLowerCase() !== "c12a7328-f81f-11d2-ba4b-00a0c93ec93b" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(esp?.uuid)
    )
      throw new Error("ESP");
    const order = (text) => /^BootOrder:\s*([0-9a-f,]+)\s*$/im.exec(text)?.[1].toUpperCase();
    const select = (text) =>
      text
        .split(/\r?\n/)
        .flatMap((line) => {
          const match =
            /^Boot([0-9a-f]{4})\*.*\bHD\(1,GPT,([^,]+),[^)]*\)\/File\(([^)]+)\)\s*$/i.exec(line);
          return match &&
            match[2].toLowerCase() === esp.uuid.toLowerCase() &&
            match[3].toUpperCase() === loader
            ? [match[1].toUpperCase()]
            : [];
        })
        .sort()[0];
    let text = await run("efibootmgr", ["-v"]);
    const before = order(text);
    if (!before) throw new Error("BootOrder missing");
    let id = select(text);
    if (!id) {
      await run("efibootmgr", [
        "--create-only",
        "--disk",
        target,
        "--part",
        "1",
        "--label",
        "Waitron",
        "--loader",
        loader,
      ]);
      text = await run("efibootmgr", ["-v"]);
      id = select(text);
      if (!id || order(text) !== before) throw new Error("entry readback");
    }
    await run("efibootmgr", ["--bootnext", id]);
    text = await run("efibootmgr", ["-v"]);
    if (
      order(text) !== before ||
      !new RegExp(`^BootNext:\\s*${id}\\s*$`, "im").test(text) ||
      select(text) !== id
    )
      throw new Error("BootNext readback");
    output.write(
      `B3_RETURN:${JSON.stringify({ entry: id, esp: esp.uuid, loader, bootOrder: before })}\n`,
    );
    await run("systemctl", ["reboot", "--no-block"]);
  } catch {
    output.write(INSTALLER_MESSAGES.failed);
    throw new Error(failed);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await installerReturn(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
