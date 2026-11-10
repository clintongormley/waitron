/** Compare the artifact and guest evidence before accepting a recipe boot. */
export function recipeFailures(expected, observed) {
  const failures = [];
  if (observed.uuid !== expected.uuid) failures.push("root-uuid");
  if (observed.hashBefore !== expected.sha256 || observed.hashAfter !== expected.sha256)
    failures.push("artifact");
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
