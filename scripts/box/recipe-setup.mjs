import { WAITRON_LAYOUTS } from "./disk-state.mjs";
import { stripVTControlCharacters } from "node:util";

export function bootstrapSucceeded(serial) {
  const plain = stripVTControlCharacters(serial);
  return (
    plain.includes('"action":"restart"') &&
    !dockerStarted(plain) &&
    !plain.includes("B3_INSTALLED:") &&
    !/B3_DISK_START:[^\r\n]*"status":[1-9]|disk_start\.refused/.test(plain)
  );
}

export function dockerStarted(serial) {
  return /(?:Starting|Started|Listening on)[^\r\n]*docker\.(?:service|socket)\b/.test(
    stripVTControlCharacters(serial),
  );
}

/** Compare the artifact and guest evidence before accepting a recipe boot. */
export function recipeFailures(expected, observed) {
  const failures = [];
  if (observed.uuid !== expected.uuid) failures.push("root-uuid");
  if (observed.hashBefore !== expected.sha256 || observed.hashAfter !== expected.sha256)
    failures.push("artifact");
  return [...failures, ...bootFailures(expected, observed)];
}

function bootFailures(expected, observed) {
  const failures = [];
  for (const [name, image] of Object.entries(expected.images)) {
    if (observed.images?.[name] !== image) failures.push(`image:${name}`);
  }
  for (const name of ["app", "print-agent", "mailpit"]) {
    if (observed.services?.[name] !== "running") failures.push(`service:${name}`);
  }
  const status = observed.status;
  if (
    typeof status !== "object" ||
    status === null ||
    Array.isArray(status) ||
    status.provisioned !== false ||
    status.environment !== "preproduction" ||
    status.installationOrigin !== "usb" ||
    JSON.stringify(status.needs) !== '["venue"]' ||
    ["developmentMode", "operation", "operationBlocked"].some((key) => Object.hasOwn(status, key))
  )
    failures.push("setup-status");
  return failures;
}

export function installedFailures(expected, installedUuid, first, again) {
  const failures = [];
  for (const boot of [first, again]) {
    failures.push(...bootFailures(expected, boot));
    if (!installedUuid || installedUuid === expected.uuid || boot.uuid !== installedUuid)
      failures.push("root-uuid");
    if (!boot.luksUuid || boot.luksUuid === boot.uuid || boot.luksUuid !== first.luksUuid)
      failures.push("luks-uuid");
    if (
      boot.luksVersion !== "2" ||
      boot.luksSubsystem !== WAITRON_LAYOUTS[0].subsystem ||
      boot.dataPartition?.type?.toLowerCase() !== WAITRON_LAYOUTS[0].typeGuid ||
      boot.dataPartition?.name !== WAITRON_LAYOUTS[0].partitionName
    )
      failures.push("disk-markers");
    const disk = boot.disk;
    if (
      disk?.action !== "ready" ||
      disk.openedBy !== "chip" ||
      disk.emptyPassword !== false ||
      disk.keySlots !== 2 ||
      disk.tpmSlots !== 1 ||
      JSON.stringify(disk.tpmPcrs) !== "[5,7,8,9,15]"
    )
      failures.push("disk-startup");
    const sizes = boot.partitionBytes;
    if (
      sizes?.length !== 3 ||
      sizes[0] !== 536870912 ||
      sizes[1] !== 1073741824 ||
      sizes[2] < 10737418240
    )
      failures.push("partitions");
    if (boot.writerAbsent !== true) failures.push("installer-present");
    if (
      JSON.stringify([...boot.areas].sort()) !==
      '["@host-state","@images","@logs","@rootfs","@volumes"]'
    )
      failures.push("areas");
  }
  if (!first.machineId || first.machineId !== again.machineId) failures.push("machine-id");
  if (!first.ca || first.ca !== again.ca) failures.push("ca");
  return [...new Set(failures)];
}

export function rigLine(serial, prefix) {
  return serial
    .split(/\r?\n/)
    .slice(0, -1)
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
}

export function installSucceeded(serial) {
  return /unit=waitron-dev-install [^\r\n]*res=success(?:'|\s)/.test(serial);
}
