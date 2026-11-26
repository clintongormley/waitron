import { randomUUID } from "node:crypto";

/** Past FAT32's 4 GiB file limit, so only exFAT or NTFS can hold it. */
export const USB_FILE_BYTES = 4_400_000_000;

const MIB = 2 ** 20;
const ARCHIVE_NAME =
  /^waitron-\d{8}T\d{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.backup\.enc$/;

/** A name the server's parseBackupArchiveKey accepts. @param {Date} now */
export function usbBackupName(now) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `waitron-${stamp}-${randomUUID()}-${randomUUID()}.backup.enc`;
}

/** @param {string | undefined} value  B3_USB_FILE_BYTES */
export function usbFileBytes(value) {
  if (value === undefined || value === "") return USB_FILE_BYTES;
  const bytes = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(bytes))
    throw new Error("B3_USB_FILE_BYTES must be a whole number of bytes");
  return bytes;
}

/** @param {number} fileBytes */
export function usbImageBytes(fileBytes) {
  return Math.ceil(fileBytes / MIB) * MIB + 64 * MIB;
}

/** Human-monitor lines that plug the image in as a read-only USB disk. @param {string} image */
export function hotplugCommands(image) {
  if (/[,\s]/.test(image)) throw new Error("usb image path holds a comma or space");
  return [
    `drive_add 0 if=none,id=usbdrive,file=${image},format=raw,readonly=on`,
    "device_add usb-storage,bus=usb.0,drive=usbdrive,id=usbdisk,serial=waitron-rig-drive",
  ];
}

/** @param {string} transcript */
export function monitorRefused(transcript) {
  return /\berror\b|could not|\bfailed\b/i.test(transcript);
}

/**
 * Node code for the guest, run as root: it asks the box's host socket as user 10001, as the app
 * does, and reads the file inside the app container as user 10001.
 * @param {string} fileName
 * @param {{socket?: string, box?: string}} [where]  the host socket and the Compose folder
 */
export function usbGuestScript(
  fileName,
  { socket = "/run/waitron-box/box.sock", box = "/opt/waitron" } = {},
) {
  if (!ARCHIVE_NAME.test(fileName)) throw new Error("usb file name is not a backup archive's");
  return `const cp=require("node:child_process");
const file=${JSON.stringify(fileName)};
const client='const c=require("node:net").connect(${JSON.stringify(socket)});let t="";c.setTimeout(25000,()=>{c.destroy();process.exitCode=1});c.on("connect",()=>c.write(process.argv[1]+"\\\\n"));c.on("data",b=>t+=b);c.on("end",()=>process.stdout.write(t));c.on("error",e=>{throw e})';
const ask=verb=>JSON.parse(cp.execFileSync("setpriv",["--reuid=10001","--regid=10001","--clear-groups","node","-e",client,verb+" "+JSON.stringify({actor:{source:"server"}})],{encoding:"utf8",timeout:30000}));
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
try{
const app=cp.execFileSync("docker",["compose","ps","-q","app"],{cwd:${JSON.stringify(box)},encoding:"utf8"}).trim();
const inApp=(args,timeout=30000)=>cp.spawnSync("docker",["exec","-u","10001",app,...args],{encoding:"utf8",timeout});
console.log("B3_USB_WAITING");
const until=Date.now()+180000;
let list=ask("storage.list");
while(!(list.ok===true&&list.drives.length>0)&&Date.now()<until){sleep(1000);list=ask("storage.list");}
const drive=list.drives?.[0]?.drive;
const path="/run/waitron-drives/"+drive+"/"+file;
const uid=inApp(["id","-u"]).stdout.trim();
const hashed=inApp(["sha256sum",path],1500000);
const sha256=hashed.status===0?hashed.stdout.split(" ")[0]:undefined;
const release=ask("storage.release");
const after=inApp(["test","-e",path]);
console.log("B3_USB_RESULT:"+JSON.stringify({list,drive,uid,sha256,hashError:hashed.stderr,release,goneInContainer:after.status===1}));
}catch(error){console.log("B3_USB_FAILED:"+JSON.stringify(String(error?.message??error)));process.exitCode=1;}
`;
}

/**
 * @param {{list?: any, drive?: string, uid?: string, sha256?: string, release?: any,
 *   goneInContainer?: boolean} | undefined} result  the guest's B3_USB_RESULT
 * @param {string} sha256  the file's hash as written
 */
export function usbDriveFailures(result, sha256) {
  if (result?.list?.ok !== true) return ["list"];
  const failures = [];
  const drives = result.list.drives ?? [];
  const [only] = drives;
  if (
    drives.length !== 1 ||
    only.fileSystem !== "exfat" ||
    only.readable !== true ||
    only.drive !== result.drive
  )
    failures.push("drive");
  if (result.uid !== "10001") failures.push("uid");
  if (result.sha256 !== sha256) failures.push("hash");
  if (
    result.release?.ok !== true ||
    !Number.isInteger(result.release.released) ||
    result.release.released < 1
  )
    failures.push("release");
  if (result.goneInContainer !== true) failures.push("still-visible");
  return failures;
}
