/**
 * @param {{keySlots:number, tpmSlots:number, emptyPassword:boolean, openedBy:string|null}} state
 * @returns {'enroll'|'remove-empty'|'ready'}
 */
export function diskStartupAction(state) {
  if (
    state.keySlots === 1 &&
    state.tpmSlots === 0 &&
    state.emptyPassword === true &&
    state.openedBy === "bootstrap"
  )
    return "enroll";
  if (state.tpmSlots === 1 && state.openedBy === "chip") {
    if (state.keySlots === 3 && state.emptyPassword === true) return "remove-empty";
    if (state.keySlots === 2 && state.emptyPassword === false) return "ready";
  }
  throw Object.assign(new Error("disk_start.refused"), { code: "disk_start.refused" });
}
