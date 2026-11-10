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
