export type { ReceiptConfig, ReceiptLogoRasters, StoredLogoRaster } from "./types.js";
export { DEFAULT_RECEIPT } from "./defaults.js";
export {
  MAX_RECEIPT_EMAIL_LENGTH,
  MAX_RECEIPT_FIELD_LENGTH,
  MAX_RECEIPT_PHONE_LENGTH,
  validateReceiptConfig,
  validateDepartmentReceipt,
  validateVenueReceiptSettings,
} from "./validate.js";

export {
  FORM_FACTORS,
  CAPABILITY_FLAGS,
  NAVIGATION_SCREENS,
  PROFILE_ACTIONS,
  PROFILE_SCREENS,
  kindOfFormFactor,
} from "./device-types.js";
export type {
  FormFactor,
  DeviceKind,
  CapabilityFlag,
  NavigationScreen,
  ProfileAction,
  ProfileScreen,
} from "./device-types.js";
export {
  isSharedDisplay,
  profileAllows,
  validateCapabilities,
  validateInactivityTimeout,
  validateStartingScreen,
  DEFAULT_PROFILE_CAPABILITIES,
  DEFAULT_DEVICE_PROFILES,
  defaultProfileName,
} from "./device-profile.js";
export type { DefaultDeviceProfile } from "./device-profile.js";
export {
  listDeviceProfiles,
  getDeviceProfile,
  getDeviceProfileWithPrinters,
  readProfileStartingScreen,
  createDeviceProfile,
  updateDeviceProfile,
  deleteDeviceProfile,
} from "./device-profile-store.js";
export type { DeviceProfileRow, DeviceProfileSettings } from "./device-profile-store.js";
export {
  emptyPrinterLists,
  readProfilePrinterLists,
  setProfilePrinterLists,
} from "./device-printers.js";
export {
  chosenPrinterOf,
  clearUnlistedPrinterChoices,
  readPrinterRoles,
  readPrinterEquipment,
  releaseDevicePrinters,
  refuseDeletedPrinters,
  resolveDevicePrinterId,
  resolveDevicePrinterIds,
  selectDevicePrinter,
  setPrinterPortable,
  settleDevicePrinters,
  settleProfilePrinterDevices,
} from "./device-equipment.js";
export type {
  ListedPrinter,
  PrinterEquipment,
  PrinterInfo,
  PrinterRoleState,
  SelectDevicePrinterInput,
  SelectDevicePrinterResult,
} from "./device-equipment.js";
export type { PrinterRole, ProfilePrinterRole, ProfilePrinterLists } from "./device-printers.js";
export {
  encodeLogoRaster,
  getPrintedReceipt,
  getReceipt,
  getStoredLogoRasters,
  getVenueReceiptSettings,
  putVenueReceiptSettings,
  putReceipt,
} from "./receipt-store.js";
export { parseThemeChoices, parseThemeName } from "./theme-input.js";
export {
  createCustomTheme,
  listCustomThemes,
  readThemeInUse,
  saveCustomTheme,
  setThemeInUse,
} from "./theme-store.js";
export type { StoredTheme, ThemeInUse, ThemeList } from "./theme-store.js";

// Keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from the public
// barrel (the rule is in packages/shared/src/errors.ts).
import "./errors.js";
