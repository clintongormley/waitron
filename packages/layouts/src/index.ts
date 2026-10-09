export type { ReceiptConfig, ReceiptLogoRasters, StoredLogoRaster } from "./types.js";
export { DEFAULT_RECEIPT } from "./defaults.js";
export type { ConfigValidator, WidgetConfigSchema } from "./widget-config.js";
export {
  MAX_RECEIPT_EMAIL_LENGTH,
  MAX_RECEIPT_FIELD_LENGTH,
  MAX_RECEIPT_PHONE_LENGTH,
  validateReceiptConfig,
  validateDepartmentReceipt,
  validateVenueReceiptSettings,
} from "./validate.js";
export { MAX_TAB_TITLE_LENGTH, validateCanvas } from "./validate-canvas.js";

export {
  FORM_FACTORS,
  CARD_TYPES,
  CAPABILITY_FLAGS,
  NAVIGATION_SCREENS,
  PROFILE_ACTIONS,
  PROFILE_SCREENS,
  kindOfFormFactor,
} from "./canvas.js";
export type {
  FormFactor,
  DeviceKind,
  CardType,
  CapabilityFlag,
  NavigationScreen,
  ProfileAction,
  ProfileScreen,
  CardInstance,
  TabDef,
  ThemeOverride,
  CanvasDef,
} from "./canvas.js";
export { CARD_CONTRACTS, SALE_CRITICAL_CARDS, GRID_MAX_COLUMNS } from "./card-contract.js";
export type { CardContract } from "./card-contract.js";
export { validateThemeOverride, THEMEABLE_TOKENS, MAX_THEME_VALUE_LENGTH } from "./theme.js";
export { DEFAULT_CANVASES } from "./default-canvases.js";
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
  listCanvases,
  getCanvas,
  createCanvas,
  updateCanvas,
  deleteCanvas,
  getCanvasForFormFactor,
} from "./canvas-store.js";
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
  clearUnlistedPrinterChoices,
  readPrinterRoles,
  readPrinterEquipment,
  releaseDevicePrinters,
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
export { getTenantTheme, putTenantTheme } from "./theme-store.js";
export {
  encodeLogoRaster,
  getPrintedReceipt,
  getReceipt,
  getStoredLogoRasters,
  putReceipt,
} from "./receipt-store.js";

// Keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from the public
// barrel (the rule is in packages/shared/src/errors.ts).
import "./errors.js";
