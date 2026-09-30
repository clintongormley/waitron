import { css, html, nothing } from "lit";

/** Tells the browser's password manager whose saved login a password field wants, without adding a
 * visible or keyboard-reachable control. Without it, Chromium 153 holding two logins for the site
 * filled the profile's current-password field with the other login's password (C98). */
export const autofillUsernameStyles = css`
  .autofill-username {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
  }
`;

export function autofillUsername(email: string | null) {
  return email
    ? html`<input
        class="autofill-username"
        name="username"
        type="email"
        autocomplete="username"
        .value=${email}
        tabindex="-1"
        aria-hidden="true"
        readonly
      />`
    : nothing;
}
