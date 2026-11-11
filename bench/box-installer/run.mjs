import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createHash, X509Certificate } from "node:crypto";
import { appendFileSync, createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, copyFile, truncate, open, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { runDiskCommand } from "../../scripts/box/disk-start.mjs";
import { findNameTag, decodeNameTag } from "../../scripts/box/name-tag.mjs";
import { diskRecoveryKeyPassphrase } from "../../scripts/box/disk-recovery-key.mjs";
import { parseRigArgs } from "../../scripts/box/rig-contract.mjs";
import {
  recipeFailures,
  installedFailures,
  rigLine,
  installSucceeded,
  bootstrapSucceeded,
  dockerStarted,
  bootHasOrderingCycle,
} from "../../scripts/box/recipe-setup.mjs";

const { caseName, runDir } = parseRigArgs(process.argv.slice(2));
const started = Date.now();
if (
  caseName === "installed-setup" ||
  caseName === "installed-refusals" ||
  caseName === "existing-stick"
) {
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
for (const name of ["waitron-disk-start", "waitron-disk-ready"]) {
  const bypass = Buffer.from(
    "[Unit]\nDefaultDependencies=no\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/true\nRemainAfterExit=yes\n",
  ).toString("base64");
  args.push(
    "-smbios",
    `type=11,value=io.systemd.credential.binary:systemd.extra-unit.${name}.service=${bypass}`,
  );
}
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
      if (bootHasOrderingCycle(serial)) {
        error = new Error("recipe boot has an ordering cycle");
        reject(error);
      }
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
  await mkdir(runDir, { mode: 0o700 });
  const tpmRoot = join(process.env.XDG_RUNTIME_DIR || "/run", `waitron-b3-tpm-${process.pid}`);
  await mkdir(tpmRoot, { mode: 0o700 });
  const tpmSocket = join(tpmRoot, "control.sock");
  let tpm;
  const stopTpm = () => {
    if (tpm && tpm.exitCode === null && tpm.signalCode === null) tpm.kill("SIGTERM");
  };
  async function startTpm() {
    stopTpm();
    if (tpm && tpm.exitCode === null && tpm.signalCode === null)
      await new Promise((done) => tpm.once("exit", done));
    tpm = spawn(
      "swtpm",
      [
        "socket",
        "--tpm2",
        "--tpmstate",
        `dir=${tpmRoot}`,
        "--ctrl",
        `type=unixio,path=${tpmSocket}`,
        "--flags",
        "not-need-init,startup-clear",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    tpm.stderr.on("data", (bytes) => appendFileSync(join(runDir, "tpm.log"), bytes));
    await new Promise((done, reject) => {
      tpm.once("error", reject);
      tpm.once("exit", (code) => reject(new Error(`TPM exited ${code}`)));
      const until = Date.now() + 10000;
      const check = async () => {
        try {
          await stat(tpmSocket);
          done();
        } catch {
          if (Date.now() > until) reject(new Error("TPM socket deadline"));
          else setTimeout(check, 20);
        }
      };
      void check();
    });
    return tpmSocket;
  }
  process.once("exit", stopTpm);
  try {
    await installedDiskRun(resolve(argument), tpmRoot, startTpm);
  } finally {
    stopTpm();
    process.removeListener("exit", stopTpm);
  }
}

async function installedDiskRun(stick, tpmRoot, startTpm) {
  const output = dirname(stick);
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
  const vars = join(runDir, "persistent-vars.fd");
  await copyFile("/usr/share/OVMF/OVMF_VARS_4M.fd", vars);
  async function retainedKeyProof(target, proof, root, diskUuid) {
    const mounted = join(root, "read-proof");
    const unlocked = join(root, "unlocked");
    await mkdir(mounted);
    await mkdir(unlocked);
    const layout = JSON.parse(
      execFileSync("sfdisk", ["--json", target], { encoding: "utf8" }),
    ).partitiontable;
    const partition = layout.partitions[2];
    const loop = execFileSync(
      "losetup",
      [
        "--find",
        "--show",
        "--read-only",
        "--offset",
        String(partition.start * layout.sectorsize),
        "--sizelimit",
        String(partition.size * layout.sectorsize),
        target,
      ],
      { encoding: "utf8" },
    ).trim();
    const mapping = `waitron-b3-proof-${process.pid}`;
    let proofMounted = false,
      opened = false,
      dataMounted = false;
    try {
      execFileSync("mount", ["-o", "ro,loop", proof, mounted]);
      proofMounted = true;
      const path = `${diskUuid}.json`;
      const text = await readFile(join(mounted, path), "utf8");
      const record = JSON.parse(text);
      if (record.diskUuid !== diskUuid || !/^[0-9a-f]{64}$/.test(record.key))
        throw new Error("retained record identity");
      const empty = await runDiskCommand(
        "cryptsetup",
        ["open", "--test-passphrase", "--key-file", "/proc/self/fd/3", loop],
        new Uint8Array(),
      );
      if (empty.status !== 2)
        throw new Error(`independent empty-password refusal: ${empty.status}`);
      const secret = diskRecoveryKeyPassphrase(Buffer.from(record.key, "hex"));
      const result = await runDiskCommand(
        "cryptsetup",
        ["open", "--readonly", "--key-file", "/proc/self/fd/3", loop, mapping],
        secret,
      );
      if (result.status !== 0) throw new Error(`independent retained-key unlock: ${result.status}`);
      opened = true;
      execFileSync("mount", ["-o", "ro,subvol=@host-state", `/dev/mapper/${mapping}`, unlocked]);
      dataMounted = true;
      if ((await readFile(join(unlocked, "disk-recovery", path), "utf8")) !== text)
        throw new Error("unlocked retained record differs");
      await writeFile(
        join(runDir, "retained-key-proof.json"),
        JSON.stringify({ diskUuid, emptyRefused: true, unlocked: true, recordMatches: true }),
      );
    } finally {
      if (dataMounted) execFileSync("umount", [unlocked]);
      if (opened) execFileSync("cryptsetup", ["close", mapping]);
      if (proofMounted) execFileSync("umount", [mounted]);
      execFileSync("losetup", ["-d", loop]);
    }
  }
  async function headerProof(label) {
    const before = await diskHash(target);
    const layout = JSON.parse(
      execFileSync("sfdisk", ["--json", target], { encoding: "utf8" }),
    ).partitiontable;
    const part = layout.partitions[2];
    const loop = execFileSync(
      "losetup",
      [
        "--find",
        "--show",
        "--read-only",
        "--offset",
        String(part.start * layout.sectorsize),
        "--sizelimit",
        String(part.size * layout.sectorsize),
        target,
      ],
      { encoding: "utf8" },
    ).trim();
    let metadata;
    try {
      metadata = JSON.parse(
        execFileSync("cryptsetup", ["--disable-locks", "luksDump", "--dump-json-metadata", loop], {
          encoding: "utf8",
        }),
      );
    } finally {
      execFileSync("losetup", ["-d", loop]);
    }
    const after = await diskHash(target);
    if (before !== after) throw new Error("header proof changed target");
    const bytes = findNameTag(Buffer.from(JSON.stringify(metadata)));
    const result = {
      tag: bytes === null ? null : decodeNameTag(bytes),
      keyslots: metadata.keyslots,
      otherTokens: Object.fromEntries(
        Object.entries(metadata.tokens).filter(([, token]) => token.type !== "waitron-name-tag"),
      ),
      before,
      after,
    };
    await writeFile(join(runDir, `${label}-header.json`), JSON.stringify(result, null, 2));
    return result;
  }
  const proof = join(tpmRoot, "proof.img");
  await writeFile(proof, "", { mode: 0o600 });
  await truncate(proof, 32 * 1024 ** 2);
  execFileSync("mkfs.ext4", ["-q", "-F", proof]);
  const pcrRead = "echo B3_PCRS:$(tpm2_pcrread sha256:8,9,15 | base64 -w0)";
  const bootRead =
    'echo B3_MEASURED:$(sha256sum /boot/vmlinuz-* /boot/initrd.img-* /boot/efi/EFI/BOOT/BOOTX64.EFI | sha256sum | cut -d" " -f1)';
  async function boot(name, source, marker, deadline) {
    const tpmSocket = await startTpm();
    const phaseStarted = Date.now();
    const monitor = join(runDir, `${name}-monitor.sock`);
    const args = [
      ...common,
      "-chardev",
      `socket,id=chrtpm,path=${tpmSocket}`,
      "-tpmdev",
      "emulator,id=tpm0,chardev=chrtpm",
      "-device",
      "tpm-crb,tpmdev=tpm0",
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
    const unitName = source ? "waitron-dev-install" : "waitron-disk-start";
    let observedUnit = await readFile(
      new URL(`../../deploy/box/${unitName}.service`, import.meta.url),
      "utf8",
    );
    observedUnit += `\n[Service]\nExecStartPre=/bin/sh -ec '${pcrRead}${source ? "" : `; ${bootRead}`}'\n`;
    args.push(
      "-smbios",
      `type=11,value=io.systemd.credential.binary:systemd.extra-unit.${unitName}.service=${Buffer.from(observedUnit).toString("base64")}`,
    );
    if (!source) {
      args.push("-drive", `file=${proof},format=raw,if=virtio`);
      const unit = await readFile(
        new URL("../../deploy/box/waitron-dev.service", import.meta.url),
        "utf8",
      );
      const copy =
        "mkdir -m 0700 /run/b3-key-proof; mount /dev/vdb /run/b3-key-proof; cp /var/lib/waitron-host/disk-recovery/*.json /run/b3-key-proof/; sync; umount /run/b3-key-proof";
      const clock = `const fs=require("node:fs"),net=require("node:net"); const p="/run/waitron-box/box.sock"; const s=fs.statSync(p); if(s.uid!==0||s.gid!==10001||(s.mode&511)!==432)throw Error("socket permissions"); const c=net.connect(p); let text=""; c.setTimeout(2000,()=>{c.destroy();process.exitCode=1});c.on("connect",()=>c.write("clock.status\\n"));c.on("data",b=>text+=b);c.on("end",()=>{if(JSON.parse(text).ok!==true)throw Error(text);console.log("B3_CLOCK:"+text.trim())});c.on("error",e=>{throw e})`;
      const deny = `const net=require("node:net");const c=net.connect("/run/waitron-box/box.sock");c.setTimeout(2000,()=>{c.destroy();process.exitCode=1});c.on("connect",()=>{c.destroy();process.exitCode=1});c.on("error",e=>{if(e.code!=="EACCES")throw e;console.log("B3_SOCKET_DENIED:EACCES")})`;
      const probe = (code, denied = false) =>
        `printf %%s ${Buffer.from(code).toString("base64")} | base64 -d | ${denied ? "setpriv --reuid=65534 --regid=65534 --clear-groups " : ""}node`;
      const checks = caseName === "existing-stick" ? `; ${probe(clock)}; ${probe(deny, true)}` : "";
      args.push(
        "-smbios",
        `type=11,value=io.systemd.credential.binary:systemd.extra-unit.waitron-dev.service=${Buffer.from(unit + `\n[Service]\nExecStartPost=/bin/sh -ec '${copy}${checks}'\n`).toString("base64")}`,
      );
    }
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
            if (bootHasOrderingCycle(serial)) reject(new Error(`${name} has an ordering cycle`));
            if (name === "bootstrap" && dockerStarted(serial))
              reject(new Error("bootstrap started Docker before the key was ready"));
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
    const bootstrap = await boot("bootstrap", false, "B3_DISK_START:", 300000);
    await bootstrap.finish();
    if (!bootstrapSucceeded(bootstrap.serial))
      throw new Error("bootstrap did not restart without Docker");
    const require = createRequire(new URL("../../apps/setup/package.json", import.meta.url));
    const { chromium } = require("playwright");
    async function inspect(name) {
      const guest = await boot(name, false, "B3_INSTALLED:", 300000);
      try {
        const observed = JSON.parse(rigLine(guest.serial, "B3_INSTALLED:"));
        if (caseName === "existing-stick") {
          const until = Date.now() + 20_000;
          while (
            !rigLine(guest.serial, "B3_CLOCK:") ||
            !guest.serial.includes("B3_SOCKET_DENIED:EACCES")
          ) {
            if (Date.now() >= until) throw new Error("clock/socket probe did not finish");
            await new Promise((done) => setTimeout(done, 100));
          }
        }
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
          if (caseName === "existing-stick" && name === "again") {
            const prepared = await context.request.post("https://127.0.0.1/setup-api/provision", {
              data: {
                mode: "prepare",
                venue: {
                  country: "ES",
                  taxId: "50000000R",
                  legalName: "Harbour Restaurant Ltd",
                  name: "Harbour dining room",
                  taxpayerDomicile: "Mayor 1, Madrid",
                  fiscalTerritory: "ES-common",
                  invoiceLocales: ["es-ES"],
                  operationDescription: "Restaurant service",
                  addressLine1: "Mayor 1",
                  addressLine2: null,
                  postalCode: "28013",
                  city: "Madrid",
                  province: "Madrid",
                  timeZone: "Europe/Madrid",
                  dayCutover: "05:00",
                  seriesCode: "A",
                  fullSeriesCode: "FF",
                  rectificativeSeriesCode: "R",
                  admin: {
                    firstNames: "Alex",
                    lastNames: "Example",
                    displayName: "Alex",
                    email: "alex@example.test",
                    password: "SYNTHETIC-owner-password",
                    pin: "4826",
                  },
                },
                email: {
                  server: "127.0.0.1",
                  port: 1025,
                  encryption: "none",
                  from: "venue@example.test",
                },
              },
            });
            if (prepared.status() !== 200)
              throw new Error(`Prepare HTTP ${prepared.status()}: ${await prepared.text()}`);
            const until = Date.now() + 120000;
            while (true) {
              const health = await context.request
                .get("https://127.0.0.1/health")
                .catch(() => null);
              const body = health === null ? null : await health.json().catch(() => null);
              const tag = body?.jobs?.["box.name_tag"];
              if (tag?.state === "waiting" && tag.lastOkAt && tag.consecutiveFailures === 0) {
                observed.tagJob = tag;
                break;
              }
              if (Date.now() >= until)
                throw new Error(`tag writer deadline: ${JSON.stringify(body)}`);
              await new Promise((done) => setTimeout(done, 200));
            }
          }
          await writeFile(join(runDir, `${name}-observed.json`), JSON.stringify(observed, null, 2));
        } finally {
          await browser.close();
        }
        observed.pcrs = Buffer.from(rigLine(guest.serial, "B3_PCRS:"), "base64").toString();
        observed.measured = rigLine(guest.serial, "B3_MEASURED:");
        return observed;
      } finally {
        await guest.stop();
      }
    }
    const first = await inspect("first");
    const beforeTag = caseName === "existing-stick" ? await headerProof("before-prepare") : null;
    const again = await inspect("again");
    if (caseName === "existing-stick") {
      const afterTag = await headerProof("after-prepare");
      if (
        JSON.stringify(afterTag.tag) !==
        JSON.stringify({ name: "Harbour Restaurant Ltd", live: false })
      )
        throw new Error("real writer tag mismatch");
      if (
        JSON.stringify(beforeTag.keyslots) !== JSON.stringify(afterTag.keyslots) ||
        JSON.stringify(beforeTag.otherTokens) !== JSON.stringify(afterTag.otherTokens)
      )
        throw new Error("tag writer changed unlock material");
      for (const name of ["first", "again"]) {
        const serial = await readFile(join(runDir, `${name}-serial.log`), "utf8");
        if (!rigLine(serial, "B3_CLOCK:") || !serial.includes("B3_SOCKET_DENIED:EACCES"))
          throw new Error("clock/socket binding not qualified");
      }
      const before = await diskHash(target);
      const guest = await boot(
        "existing-stick",
        true,
        "This box already has Waitron (Harbour Restaurant Ltd).",
        300000,
      );
      await guest.finish();
      const after = await diskHash(target);
      if (before !== after) throw new Error("existing-stick changed target");
      await writeFile(
        join(runDir, "existing-stick.json"),
        JSON.stringify({ tag: afterTag.tag, before, after, writer: again.tagJob }, null, 2),
      );
    }
    const sourcePcr = Buffer.from(rigLine(install.serial, "B3_PCRS:"), "base64").toString();
    const bootstrapPcr = Buffer.from(rigLine(bootstrap.serial, "B3_PCRS:"), "base64").toString();
    const pcr = (text, index) =>
      new RegExp(`\\b${index}\\s*:\\s*0x([0-9a-fA-F]{64})`).exec(text)?.[1].toLowerCase();
    for (const index of [8, 9]) {
      const before = pcr(sourcePcr, index);
      const after = pcr(bootstrapPcr, index);
      if (!before || !after || /^0+$/.test(before) || /^0+$/.test(after) || before === after)
        throw new Error(`PCR${index} did not distinguish stick from installed disk`);
    }
    for (const text of [bootstrapPcr, first.pcrs, again.pcrs])
      if (pcr(text, 15) !== "8878b15a7d6a3a4f464e8f9f42591dbc0cf4bedea0ec309003d2b2ee53655ef8")
        throw new Error("PCR15 was not extended exactly once");
    const measured = rigLine(bootstrap.serial, "B3_MEASURED:");
    if (
      !/^[a-f0-9]{64}$/.test(measured) ||
      measured !== first.measured ||
      measured !== again.measured
    )
      throw new Error("measured boot bytes changed after enrollment");
    await retainedKeyProof(target, proof, tpmRoot, first.luksUuid);
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
