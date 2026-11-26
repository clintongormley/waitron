import {
  chooseTheme,
  themeChoices,
  type ThemeChoice,
  type WtRowActions,
  type WtThemeLabels,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-menu-row.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { css, html, nothing, type TemplateResult } from "lit";
import { currentLocale, fill, t } from "./i18n/t.js";

export const accountMenuStyles = css`
  [data-test="account-menu"]::part(trigger) {
    display: grid;
    place-items: center;
  }

  [data-test="account-menu"]::part(popup) {
    inline-size: min(36ch, calc(100vw - 2 * var(--wt-space-2)));
  }

  .account-initials {
    display: inline-grid;
    place-items: center;
    inline-size: calc(var(--wt-space-5) + var(--wt-space-1));
    block-size: calc(var(--wt-space-5) + var(--wt-space-1));
    border-radius: var(--wt-radius-full);
    background: var(--wt-color-surface-lifted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
  }

  .account-initials::before {
    content: attr(data-initials);
  }

  .account-identity {
    min-inline-size: 0;
    padding: var(--wt-space-2) var(--wt-space-3);
  }

  .account-name,
  .account-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-name {
    font-weight: var(--wt-font-weight-bold);
  }

  .account-email {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  [data-test="account-menu"] .theme-choices {
    padding-block: var(--wt-space-2);
    row-gap: var(--wt-space-2);
  }

  .account-language {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wt-space-2);
    padding: var(--wt-space-2) var(--wt-space-3);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
`;

function initials(name: string): string {
  const letters = name
    .normalize("NFC")
    .split(/\s+/u)
    .flatMap((word) => word.match(/\p{L}\p{M}*/u)?.[0] ?? []);
  const first = letters[0] ?? "";
  const last = letters.length > 1 ? letters.at(-1)! : "";
  return `${first}${last}`.toLocaleUpperCase(currentLocale());
}

export function accountMenu(options: {
  displayName: string | undefined;
  email: string | null | undefined;
  theme: ThemeChoice;
  themeLabels: WtThemeLabels;
  loadLocales: () => Promise<{ code: string; label: string }[]>;
  onOpen: (open: boolean) => void;
  onProfile: () => void;
  onAbout: () => void;
  onLogout: () => void;
}): TemplateResult {
  const name = options.displayName?.trim();
  const badge = name ? initials(name) : "";
  return html`<wt-row-actions
    icon="account-person"
    align="end"
    .iconSize=${"lg"}
    label=${name ? fill("nav.account_menu_person", { name }) : t("nav.account_menu")}
    data-test="account-menu"
    @wt-row-actions-toggle=${(event: CustomEvent<{ open: boolean }>) => {
      if (event.target === event.currentTarget) options.onOpen(event.detail.open);
    }}
    @wt-locale-selected=${(event: Event) => {
      const menu = event.currentTarget as WtRowActions;
      menu.hide({ restoreFocus: true });
    }}
  >
    ${
      badge
        ? html`<span
            slot="trigger"
            class="account-initials"
            aria-hidden="true"
            data-initials=${badge}
          ></span>`
        : nothing
    }
    ${
      name
        ? html`<div class="account-identity" data-test="account-identity">
              <div class="account-name" data-test="account-name">${name}</div>
              ${
                options.email
                  ? html`<div class="account-email" data-test="account-email">
                      ${options.email}
                    </div>`
                  : nothing
              }
            </div>
            <hr />`
        : nothing
    }
    <wt-menu-row
      data-test="profile-row"
      help=${t("help.account.settings")}
      help-label=${fill("help.badge_label", { part: t("action.account_settings") })}
      ><wt-button icon="menu-account" data-test="profile" @click=${options.onProfile}
        >${t("action.account_settings_dialog")}</wt-button
      ></wt-menu-row
    >
    <hr />
    ${themeChoices({
      active: options.theme,
      labels: options.themeLabels,
      shortDeviceLabel: t("theme.device_short"),
      onPick: chooseTheme,
    })}
    <div class="account-language" data-test="language-row">
      <span>${t("profile.language")}</span>
      <wt-language-chooser
        opens-below
        data-keep-open
        data-test="language-chooser"
        .active=${currentLocale()}
        .loadLocales=${options.loadLocales}
      ></wt-language-chooser>
    </div>
    <hr />
    <wt-button icon="menu-details" data-test="about" @click=${options.onAbout}
      >${t("about.title")}</wt-button
    >
    <wt-button icon="menu-logout" data-test="logout" @click=${options.onLogout}
      >${t("action.logout")}</wt-button
    >
  </wt-row-actions>`;
}
