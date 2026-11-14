import { userEvent } from "vitest/browser";
import type { DashboardApi, ProfileScopeChoices } from "../api/client.js";
import type { DeviceProfilesScreen } from "../screens/device-profiles-screen.js";

export function profileListRoot(screen: DeviceProfilesScreen): ShadowRoot {
  return screen.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
}

export async function profileAction(screen: DeviceProfilesScreen, id: string) {
  const item = profileListRoot(screen).querySelector<HTMLElement>(`[data-test="${id}"]`)!;
  const menu = item.closest("wt-row-actions")!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await menu.updateComplete;
  await userEvent.click(item);
  await screen.updateComplete;
}

export function withProfileListRead(api: DashboardApi, choices: ProfileScopeChoices): DashboardApi {
  if (api.background) return api;
  let initial = true;
  return Object.assign(api, {
    background: {
      ...api,
      getProfileScopeChoices: () => {
        if (!initial) return api.getProfileScopeChoices();
        initial = false;
        return Promise.resolve(choices);
      },
    },
  });
}
