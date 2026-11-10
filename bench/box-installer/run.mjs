import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createHash, X509Certificate } from "node:crypto";
import { appendFileSync, createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, copyFile, truncate, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { parseRigArgs } from "../../scripts/box/rig-contract.mjs";
import {
  recipeFailures,
  installedFailures,
  rigLine,
  installSucceeded,
} from "../../scripts/box/recipe-setup.mjs";

const { caseName, runDir } = parseRigArgs(process.argv.slice(2));
const started = Date.now();
if (caseName === "installed-setup" || caseName === "installed-refusals") {
  await installedRun();
  process.exit(0);
}
if (caseName !== "recipe-setup") throw new Error("Only recipe-setup is implemented here");
const imageArgument = process.env.B3_RECIPE_IMAGE;
if (imageArgument === undefined || imageArgument === "")
  throw new Error("B3_RECIPE_IMAGE must be set");
await mkdir(runDir, { mode: 0o700 });
const image = resolve(imageArgument);
const output = dirname(image);
const populate = process.env.B3_POPULATE === "1";
const uuid = (await readFile(join(output, "uuid"), "utf8")).trim();
const hash = async () => {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(image)) digest.update(bytes);
  return digest.digest("hex");
};
const hashBefore = populate ? undefined : await hash();
const preload = `set -euxo pipefail
mkdir -p /inputs
mount -o ro /dev/vdb /inputs
for archive in /inputs/*.tar; do docker load -i "$archive"; done
cd /opt/waitron
docker compose config --images | while read -r tag; do
 docker image inspect "$tag" --format '{{.Id}} {{.Architecture}}'
done
docker compose config --format json | jq '.services | with_entries(.value = .value.image)' > /tmp/tags.json
jq -r 'to_entries[] | [.key,.value] | @tsv' /tmp/tags.json | while read -r name tag; do
 docker save -o /tmp/check.tar "$tag"
 config=$(tar -xOf /tmp/check.tar manifest.json | jq -r '.[0].Config')
 digest=$(tar -xOf /tmp/check.tar "$config" | sha256sum | cut -d' ' -f1)
 expected=$(awk -v name="$name" '$1 == name {print $2}' /inputs/expected-configs.tsv)
 test "$digest" = "$expected"
 rm /tmp/check.tar
done
for name in app print-agent mailpit; do
 tag=$(jq -r --arg name "$name" '.[$name]' /tmp/tags.json)
 id=$(docker image inspect "$tag" --format '{{.Id}}')
 jq -cn --arg name "$name" --arg id "$id" '{name:$name,id:$id}'
done | jq -sc 'map({key:.name,value:.id})|from_entries' > /opt/waitron/loaded-images.json
echo B3_LOADED:$(cat /opt/waitron/loaded-images.json)
systemctl stop docker.service docker.socket containerd.service
truncate -s 0 /etc/machine-id
echo B3_PRELOAD_OK
systemctl poweroff
`;
const smoke = `set -euxo pipefail
cd /opt/waitron
docker compose up -d --pull never
for attempt in $(seq 1 90); do
 if code=$(curl -kfsS -w "%{http_code}" -o /tmp/status.json https://127.0.0.1/setup-api/status) && [ "$code" = 200 ]; then break; fi
 sleep 1
done
test "$code" = 200
test -s /tmp/status.json
echo B3_HTTP_STATUS:$code
echo B3_STATUS:$(cat /tmp/status.json)
echo B3_UUID:$(findmnt -n -o UUID /)
echo B3_SERVICES:$(docker inspect $(docker compose ps -q) | jq -c 'map({key:.Config.Labels["com.docker.compose.service"],value:.State.Status})|from_entries')
for name in app print-agent mailpit; do
 tag=$(docker compose config --format json | jq -r --arg name "$name" '.services[$name].image')
 id=$(docker image inspect "$tag" --format '{{.Id}}')
 jq -cn --arg name "$name" --arg id "$id" '{name:$name,id:$id}'
done | jq -sc 'map({key:.name,value:.id})|from_entries' >/tmp/images.json
echo B3_IMAGES:$(cat /tmp/images.json)
echo B3_DOCKER_LOGS
docker compose logs --no-color --tail 100
echo B3_SETUP_READY
sleep infinity
`;
const script = Buffer.from(populate ? preload : smoke).toString("base64");
const unit = (await readFile(new URL("./setup-smoke.service", import.meta.url), "utf8")).replace(
  "@PAYLOAD@",
  script,
);
const credential = Buffer.from(unit).toString("base64");
const args = [
  "-machine",
  "q35,accel=tcg",
  "-cpu",
  "max",
  "-m",
  "4096",
  "-smp",
  "2",
  "-nographic",
  "-no-reboot",
  "-monitor",
  "none",
  "-kernel",
  join(output, "kernel"),
  "-initrd",
  join(output, "initrd"),
  "-drive",
  `file=${image},format=raw,if=virtio${populate ? "" : ",snapshot=on"}`,
  "-append",
  `root=UUID=${uuid} rootfstype=ext4 rw console=ttyS0 systemd.unit=setup-smoke.service rd.shell=0 rd.emergency=reboot`,
  "-smbios",
  `type=11,value=io.systemd.credential.binary:systemd.extra-unit.setup-smoke.service=${credential}`,
];
if (populate)
  args.push(
    "-nic",
    "none",
    "-drive",
    `file=${join(output, "inputs.img")},format=raw,if=virtio,readonly=on`,
  );
else args.push("-nic", "user,restrict=on,hostfwd=tcp:127.0.0.1:443-:443");
const child = spawn("qemu-system-x86_64", args, { stdio: ["ignore", "pipe", "pipe"] });
await writeFile(join(runDir, "pid.json"), JSON.stringify({ pid: child.pid, image, populate }));
let serial = "";
let error;
const marker = populate ? "B3_PRELOAD_OK" : "B3_SETUP_READY";
const hasMarker = () => serial.split(/\r?\n/).some((line) => line.trim() === marker);
const stopped = new Promise((resolveExit) =>
  child.on("exit", (code, signal) => resolveExit({ code, signal })),
);
const ready = new Promise((resolveReady, reject) => {
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      serial += chunk.toString();
      appendFileSync(join(runDir, "serial.log"), chunk);
      if (hasMarker()) resolveReady();
    });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (!hasMarker())
      reject(
        error ?? new Error(`guest exited before ${marker}: ${code}/${signal}; see serial.log`),
      );
  });
});
const timer = setTimeout(() => {
  error = new Error("guest deadline");
  child.kill("SIGTERM");
}, 600000);
try {
  await ready;
  if (populate) {
    const result = await stopped;
    if (result.code !== 0) throw new Error(`preload exit ${result.code}/${result.signal}`);
    const images = JSON.parse(serial.match(/\nB3_LOADED:([^\r\n]+)/)[1]);
    await writeFile(
      join(output, "inventory.json"),
      JSON.stringify({ uuid, images, sha256: await hash() }, null, 2),
    );
  } else {
    const require = createRequire(new URL("../../apps/setup/package.json", import.meta.url));
    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const ca = await context.request.get("https://127.0.0.1/ca.crt");
      if (ca.status() !== 200) throw new Error(`CA HTTP ${ca.status()}`);
      await writeFile(
        join(runDir, "ca-fingerprint.txt"),
        new X509Certificate(await ca.text()).fingerprint256,
      );
      const page = await context.newPage();
      page.on("pageerror", (failure) => console.error("pageerror", failure));
      page.on("requestfailed", (request) =>
        console.error("requestfailed", request.url(), request.failure()),
      );
      await page.goto("https://127.0.0.1/setup", { waitUntil: "domcontentloaded" });
      try {
        await page.locator("setup-connection-screen [data-test=continue] button").click();
        await page.locator("setup-mode-screen").waitFor();
      } finally {
        await page.screenshot({ path: join(runDir, "setup.png") });
        await writeFile(join(runDir, "page.html"), await page.content());
        await writeFile(join(runDir, "page-url.txt"), page.url());
      }
      const choices = await page
        .locator("setup-mode-screen wt-choice-row")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-test")));
      await writeFile(join(runDir, "choices.json"), JSON.stringify(choices));
      if (JSON.stringify(choices) !== '["choose-prepare","choose-live","choose-existing"]')
        throw new Error(`Unexpected USB setup choices: ${JSON.stringify(choices)}`);
      await page.getByText("Prepare your restaurant", { exact: true }).click();
      await page.locator("setup-admin-screen").waitFor();
      await page.screenshot({ path: join(runDir, "prepare.png") });
    } finally {
      await browser.close();
    }
    const status = JSON.parse(serial.match(/\nB3_STATUS:([^\r\n]+)/)[1]);
    const actualUuid = serial.match(/\nB3_UUID:([^\r\n]+)/)[1].trim();
    child.kill("SIGTERM");
    await stopped;
    const images = JSON.parse(serial.match(/\nB3_IMAGES:([^\r\n]+)/)[1]);
    const services = JSON.parse(serial.match(/\nB3_SERVICES:([^\r\n]+)/)[1]);
    const observed = {
      uuid: actualUuid,
      status,
      hashBefore,
      hashAfter: await hash(),
      images,
      services,
    };
    await writeFile(join(runDir, "observed.json"), JSON.stringify(observed, null, 2));
    const failures = recipeFailures(
      JSON.parse(await readFile(join(output, "inventory.json"), "utf8")),
      observed,
    );
    if (failures.length) throw new Error(failures.join(", "));
  }
  if (error) throw error;
} finally {
  clearTimeout(timer);
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  await stopped;
  clearTimeout(force);
  await writeFile(join(runDir, "serial.log"), serial);
  await writeFile(
    join(runDir, "timing.json"),
    JSON.stringify({ started, elapsedMs: Date.now() - started }),
  );
}

async function installedRun() {
  const argument = process.env.B3_INSTALLER_IMAGE;
  if (!argument) throw new Error("B3_INSTALLER_IMAGE must be set");
  const stick = resolve(argument);
  const output = dirname(stick);
  await mkdir(runDir, { mode: 0o700 });
  const target = join(runDir, "target.img");
  await writeFile(target, "");
  await truncate(target, 12 * 1024 ** 3);
  const diskHash = async (path) => {
    const digest = createHash("sha256");
    for await (const bytes of createReadStream(path)) digest.update(bytes);
    return digest.digest("hex");
  };
  const common = [
    "-machine",
    "q35,accel=tcg",
    "-cpu",
    "max",
    "-m",
    "4096",
    "-smp",
    "2",
    "-nographic",
    "-no-reboot",
    "-monitor",
    "none",
    "-smbios",
    "type=1,product=Waitron-B3-dev",
  ];
  async function boot(name, source, marker, deadline) {
    const phaseStarted = Date.now();
    const vars = join(runDir, `${name}-vars.fd`);
    await copyFile("/usr/share/OVMF/OVMF_VARS_4M.fd", vars);
    const monitor = join(runDir, `${name}-monitor.sock`);
    const args = [
      ...common,
      "-monitor",
      `unix:${monitor},server=on,wait=off`,
      "-drive",
      "if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd",
      "-drive",
      `if=pflash,format=raw,file=${vars}`,
    ];
    if (source)
      args.push(
        "-drive",
        `file=${stick},format=raw,if=none,id=stick,readonly=on`,
        "-device",
        "qemu-xhci,id=usb",
        "-device",
        "usb-storage,bus=usb.0,drive=stick,serial=waitron-dev-stick,bootindex=1",
      );
    args.push(
      "-drive",
      `file=${target},format=raw,if=none,id=target`,
      "-device",
      `virtio-blk-pci,drive=target,serial=waitron-dev-target,bootindex=${source ? 2 : 1}`,
      "-nic",
      source ? "none" : "user,restrict=on,hostfwd=tcp:127.0.0.1:443-:443",
    );
    await writeFile(join(runDir, `${name}-args.json`), JSON.stringify(args));
    const child = spawn("qemu-system-x86_64", args, { stdio: ["ignore", "pipe", "pipe"] });
    await writeFile(join(runDir, `${name}-pid.json`), JSON.stringify({ pid: child.pid }));
    let serial = "";
    let failure;
    const stopped = new Promise((done) =>
      child.once("exit", (code, signal) => {
        console.error(name, "exit", { code, signal });
        done({ code, signal });
      }),
    );
    const stop = async () => {
      clearTimeout(deadlineKill);
      await writeFile(
        join(runDir, `${name}-timing.json`),
        JSON.stringify({ started: phaseStarted, elapsedMs: Date.now() - phaseStarted }),
      );
      console.error(name, "stop", { code: child.exitCode, signal: child.signalCode });
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((done) => {
        const socket = createConnection(monitor);
        socket.resume();
        socket.setTimeout(1000, () => socket.destroy());
        socket.on("error", (error) => console.error(name, "monitor", error.code));
        socket.on("connect", () => {
          console.error(name, "powerdown");
          socket.end("system_powerdown\n");
        });
        socket.on("close", () => {
          console.error(name, "monitor closed");
          done();
        });
      });
      const polite = setTimeout(() => child.kill("SIGTERM"), 20000);
      const force = setTimeout(() => child.kill("SIGKILL"), 23000);
      console.error(name, "waiting for exit");
      await stopped;
      console.error(name, "stopped");
      clearTimeout(polite);
      clearTimeout(force);
    };
    let deadlineKill;
    const timer = setTimeout(() => {
      failure = new Error(`${name} deadline`);
      child.kill("SIGTERM");
      deadlineKill = setTimeout(() => child.kill("SIGKILL"), 3000);
    }, deadline);
    try {
      await new Promise((done, reject) => {
        for (const stream of [child.stdout, child.stderr])
          stream.on("data", (bytes) => {
            serial += bytes.toString();
            appendFileSync(join(runDir, `${name}-serial.log`), bytes);
            if (rigLine(serial, marker) !== undefined) done();
          });
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          reject(failure ?? new Error(`${name} exited ${code}/${signal} before ${marker}`)),
        );
      });
      return {
        get serial() {
          return serial;
        },
        finish: async () => {
          const result = await stopped;
          clearTimeout(timer);
          clearTimeout(deadlineKill);
          await writeFile(
            join(runDir, `${name}-timing.json`),
            JSON.stringify({ started: phaseStarted, elapsedMs: Date.now() - phaseStarted }),
          );
          if (failure) throw failure;
          if (result.code !== 0) throw new Error(`${name} exit ${result.code}/${result.signal}`);
        },
        stop: async () => {
          clearTimeout(timer);
          await stop();
        },
      };
    } catch (error) {
      clearTimeout(timer);
      await stop();
      throw error;
    }
  }
  if (caseName === "installed-refusals") {
    const handle = await open(target, "r+");
    try {
      await handle.write("occupied");
    } finally {
      await handle.close();
    }
    const before = await diskHash(target);
    let failure;
    try {
      const guest = await boot("refused", true, "install.refused:occupied", 300000);
      await guest.stop();
    } catch (error) {
      failure = error;
    }
    const after = await diskHash(target);
    if (before !== after) throw new Error("refused target changed");
    if (failure) throw failure;
    await writeFile(join(runDir, "refusal.json"), JSON.stringify({ before, after }));
  } else {
    const install = await boot("install", true, "B3_INSTALL_OK:", 900000);
    const installedUuid = rigLine(install.serial, "B3_INSTALL_OK:").trim();
    await install.finish();
    if (!installSucceeded(install.serial))
      throw new Error("install service did not report success");
    const require = createRequire(new URL("../../apps/setup/package.json", import.meta.url));
    const { chromium } = require("playwright");
    async function inspect(name) {
      const guest = await boot(name, false, "B3_INSTALLED:", 300000);
      try {
        const observed = JSON.parse(rigLine(guest.serial, "B3_INSTALLED:"));
        const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
        try {
          const context = await browser.newContext({ ignoreHTTPSErrors: true });
          const ca = await context.request.get("https://127.0.0.1/ca.crt");
          if (ca.status() !== 200) throw new Error(`CA HTTP ${ca.status()}`);
          observed.ca = new X509Certificate(await ca.text()).fingerprint256;
          const page = await context.newPage();
          page.on("pageerror", (error) => console.error(error));
          await page.goto("https://127.0.0.1/setup", { waitUntil: "domcontentloaded" });
          await page.locator("setup-connection-screen [data-test=continue] button").click();
          await page.locator("setup-mode-screen").waitFor();
          const choices = await page
            .locator("setup-mode-screen wt-choice-row")
            .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-test")));
          if (JSON.stringify(choices) !== '["choose-prepare","choose-live","choose-existing"]')
            throw new Error(`Unexpected setup choices: ${JSON.stringify(choices)}`);
          await page.screenshot({ path: join(runDir, `${name}-setup.png`) });
          await page.getByText("Prepare your restaurant", { exact: true }).click();
          await page.locator("setup-admin-screen").waitFor();
          await page.screenshot({ path: join(runDir, `${name}-prepare.png`) });
          await writeFile(join(runDir, `${name}-observed.json`), JSON.stringify(observed, null, 2));
        } finally {
          await browser.close();
        }
        return observed;
      } finally {
        await guest.stop();
      }
    }
    const first = await inspect("first");
    const again = await inspect("again");
    const failures = installedFailures(
      JSON.parse(await readFile(join(output, "inventory.json"), "utf8")),
      installedUuid,
      first,
      again,
    );
    if (failures.length) throw new Error(failures.join(", "));
  }
  await writeFile(
    join(runDir, "timing.json"),
    JSON.stringify({ started, elapsedMs: Date.now() - started }),
  );
}
