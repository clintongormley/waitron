// CI only: image-smoke copies this into the print-agent container and runs it with the image's own
// node, to pair the stand-in BlueZ's PIN printer (scripts/fake-bluez.py) under the AppArmor profile.
// It drives interactive bluetoothctl over pipes, with no terminal: the one-shot
// `bluetoothctl pair <MAC>` registers no agent, so nothing could answer the PIN request.
//
//   node bluetoothctl-pair.mjs <MAC> <PIN>   exits 0 when bluetoothctl printed `Pairing successful`
import { spawn } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const FAILED = /Failed to pair|Failed to register agent|not available/;

export function pairOverPipes(child, { address, pin, deadlineMs = 30_000, graceMs = 5_000 }) {
  return new Promise((resolve) => {
    let raw = "";
    let text = "";
    let registered = false;
    let pinAsked = false;
    let outcome;
    let killer;
    const deadline = setTimeout(() => {
      outcome = "timeout";
      child.stdin.end();
      killer = setTimeout(() => child.kill("SIGKILL"), graceMs);
    }, deadlineMs);
    child.stdout.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      text = stripVTControlCharacters(raw).replaceAll("\b", "");
      if (outcome) return;
      if (!registered && text.includes("Agent registered")) {
        registered = true;
        child.stdin.write(`pair ${address}\n`);
      }
      if (registered && !pinAsked && text.includes("[agent] Enter PIN code:")) {
        pinAsked = true;
        child.stdin.write(`${pin}\n`);
      }
      if (text.includes("Pairing successful")) outcome = "paired";
      else if (FAILED.test(text)) outcome = "failed";
      if (outcome) child.stdin.end("quit\n");
    });
    child.on("close", () => {
      clearTimeout(deadline);
      clearTimeout(killer);
      resolve({ outcome: outcome ?? "failed", pinAsked, transcript: text });
    });
  });
}

// The CLI cases run this block in a child process, outside the parent's coverage collector.
/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [address, pin] = process.argv.slice(2);
  if (!address || !pin) {
    console.error("usage: node bluetoothctl-pair.mjs <MAC> <PIN>");
    process.exit(2);
  }
  const child = spawn("bluetoothctl", [], { stdio: ["pipe", "pipe", "inherit"] });
  const { outcome, pinAsked, transcript } = await pairOverPipes(child, { address, pin });
  console.log(transcript.replace(/\r/g, "\n").replace(/ {2,}/g, " "));
  console.log(`outcome=${outcome} pinAsked=${pinAsked}`);
  process.exitCode = outcome === "paired" ? 0 : 1;
}
/* v8 ignore stop */
