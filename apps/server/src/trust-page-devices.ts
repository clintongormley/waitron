/**
 * Every device carries its own removal steps: an operator whose server was re-imaged must clear the
 * old certificate before the new one takes effect. Guard: `trust-page-devices.test.ts`.
 *
 * Every string here is authored HTML, inserted into the page WITHOUT escaping so `<code>` renders.
 * Nothing from a request reaches this file: the page picks an entry by id and prints fixed text.
 */
import type { TrustDevice } from "./detect-device.js";

/**
 * Derived rather than restated, so `DEVICE_HELP` cannot compile while a detectable device has no
 * instructions.
 */
export type DeviceId = Exclude<TrustDevice, "unknown">;

export interface DeviceHelp {
  /** A full sentence, not a fragment. */
  readonly heading: string;
  readonly summary: string;
  /** The last step always closes and reopens the browser. */
  readonly install: readonly string[];
  readonly removal: readonly string[];
  /** Asides that are not a step — a browser that behaves differently, or a caution. */
  readonly notes?: readonly string[];
}

export const DEVICE_ORDER: readonly DeviceId[] = [
  "macos",
  "windows",
  "linux",
  "chromeos",
  "android",
  "ios",
  "firefox-linux",
];

export const DEVICE_HELP: Record<DeviceId, DeviceHelp> = {
  macos: {
    heading: "Install it on this Mac",
    summary: "macOS — Safari, Chrome, Edge and Firefox",
    install: [
      "Open the downloaded file with Keychain Access and add it to your login keychain.",
      "Open the certificate in Keychain Access, expand Trust, and set Secure Sockets Layer (SSL) to Always Trust. Close the window and approve the change with your Mac password if asked.",
      "Quit your browser completely, then reopen this page.",
    ],
    removal: [
      "Find the old Waitron entry in Keychain Access and delete it. Check both the login and System keychains: it may have been installed more than once.",
    ],
    notes: [
      "Using Firefox? In its Settings, under Privacy &amp; Security, Certificates, turn on “Allow Firefox to automatically trust third-party root certificates you install”.",
    ],
  },
  windows: {
    heading: "Install it on this Windows PC",
    summary: "Windows — Edge, Chrome and Firefox",
    install: [
      "Open the downloaded file and choose Install Certificate, then Current User.",
      "Choose “Place all certificates in the following store”, then Browse, then Trusted Root Certification Authorities. Finish the import and approve the certificate you chose.",
      "Close every browser window to quit the browser, then reopen this page.",
    ],
    removal: [
      "Search the Start menu for “Manage user certificates”. Under Trusted Root Certification Authorities, then Certificates, delete the old Waitron entry.",
      "An administrator must remove a copy that was installed for the whole computer.",
    ],
    notes: [
      "Using Firefox? Allow installed third-party root certificates in its Privacy &amp; Security settings, or import the file with Firefox's own certificate manager.",
    ],
  },
  linux: {
    heading: "Install it on this Linux PC",
    summary: "Linux — Chrome, Chromium and Edge",
    install: [
      "In Chrome or Chromium, open Settings and search for “Manage certificates”. You can also type <code>chrome://certificate-manager</code> in the address bar.",
      "Under Custom certificates, then Trusted certificates, import the downloaded file. Older versions call this area Authorities; there, allow it to identify websites.",
      "In Edge, search its Settings for “Manage certificates” or type <code>edge://certificate-manager</code>, then import the file as a trusted authority.",
      "Quit the browser completely, then reopen this page.",
    ],
    removal: [
      "Remove the old Waitron entry from the same browser's Custom certificates or Authorities list. Repeat in every browser you installed it in.",
    ],
    notes: [
      "Install the file in each browser you will use. Firefox on Linux keeps its own list — see its instructions.",
      "If a browser your administrator manages offers no import, ask them to install the file for you.",
    ],
  },
  chromeos: {
    heading: "Install it on this Chromebook",
    summary: "ChromeOS — Chrome",
    install: [
      "Open Chrome Settings and search for “Manage certificates”, or type <code>chrome://certificate-manager</code> in the address bar.",
      "Import the downloaded file under Custom certificates, then Trusted certificates. If your version shows Authorities instead, import it there and allow it to identify websites.",
      "Close Chrome completely, then reopen this page.",
    ],
    removal: ["Delete the old Waitron entry in the same certificate manager you imported it into."],
    notes: [
      "On a managed Chromebook, ask your administrator if importing or removing is unavailable to you.",
    ],
  },
  android: {
    heading: "Install it on this Android phone or tablet",
    summary: "Android — Chrome, Edge, Firefox and Samsung Internet",
    install: [
      "Open Android Settings and search for “Install a certificate”. On a Pixel, look under Security &amp; privacy, then More security settings, then Encryption &amp; credentials.",
      "Choose CA certificate, approve the warning Android shows, unlock the device if asked, and select the downloaded file.",
      "Close your browser completely by swiping it away in the app switcher, then reopen this page.",
    ],
    removal: [
      "Return to Encryption &amp; credentials and look under User credentials, or under Trusted credentials, then User. Remove only the old Waitron certificate.",
    ],
    notes: [
      "Installing a certificate authority grants trust across the whole device. Use a venue-owned device if you would rather not grant that on a personal phone.",
    ],
  },
  ios: {
    heading: "Install it on this iPhone or iPad",
    summary: "iPhone and iPad (iOS and iPadOS) — Safari, Chrome, Edge and Firefox",
    install: [
      "Open this page in Safari to download the file, and allow the profile download when asked.",
      "Open Settings, then General, then VPN &amp; Device Management. Select the downloaded profile and install it.",
      "Open Settings, then General, then About, then Certificate Trust Settings, and turn on full trust for this certificate. Installing the profile on its own does not trust it for websites.",
      "Close the browser you want to use by swiping it away in the app switcher, then reopen this page.",
    ],
    removal: [
      "Open Settings, then General, then VPN &amp; Device Management, select the old Waitron profile, and choose Remove Profile. Install and trust the new file afterwards.",
    ],
  },
  "firefox-linux": {
    heading: "Install it in Firefox on Linux",
    summary: "Firefox on Linux — its own certificate manager",
    install: [
      "Open Settings, then Privacy &amp; Security, then Certificates, then View Certificates.",
      "Choose Authorities, then Import, select the downloaded file, and allow it to identify websites.",
      "Quit Firefox completely, then reopen this page.",
    ],
    removal: [
      "In the same Authorities list, select the old Waitron entry and choose Delete or Distrust.",
    ],
    notes: [
      "Firefox on Linux does not read the system's certificate list, so it needs this import even if you already installed the file for Chrome.",
    ],
  },
};
