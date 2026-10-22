import type { StaffNotice, StaffNoticeSource, WaitronModule } from "@waitron/module";
import type { DiskFullState } from "./disk-full-state.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import { enabledStaffNoticeSources } from "./modules.js";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";

/** Owner name of the notices the box itself gives; no module is named this. */
export const BOX_NOTICE_OWNER = "box";

const DISK_FULL: StaffNotice = {
  key: "storage.disk_full",
  code: "storage.disk_full",
  severity: "error",
  params: {},
};

const SPACE_LOW: StaffNotice = {
  key: "storage.space_low",
  code: "storage.space_low",
  severity: "warning",
  params: {},
};

/** `storage.disk_full` while the full-disk stop is noted, otherwise `storage.space_low` while the
 * low-space warning is on. Reads no disk. */
export function boxStaffNoticeSource(deps: {
  disk: Pick<DiskFullState, "since">;
  space: Pick<FreeSpaceState, "current">;
}): StaffNoticeSource {
  return {
    read: () => {
      if (deps.disk.since() !== null) return Promise.resolve([DISK_FULL]);
      if (deps.space.current().lowSince !== null) return Promise.resolve([SPACE_LOW]);
      return Promise.resolve([]);
    },
  };
}

/** The box's source, then the modules', so the box's notice comes first among equal severities.
 * Give it the enabled modules. */
export function deviceNoticeSources(
  box: Parameters<typeof boxStaffNoticeSource>[0],
  modules: readonly WaitronModule[],
): readonly OwnedStaffNoticeSource[] {
  return [
    { owner: BOX_NOTICE_OWNER, source: boxStaffNoticeSource(box) },
    ...enabledStaffNoticeSources(modules),
  ];
}
