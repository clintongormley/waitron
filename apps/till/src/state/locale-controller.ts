import type { ReactiveControllerHost } from "lit";
import { ChangeObserver } from "@waitron/ui";
import { subscribeLocale } from "../i18n/t.js";

export class LocaleChangeController extends ChangeObserver {
  constructor(host: ReactiveControllerHost, handler?: () => void) {
    super(host, subscribeLocale, handler);
  }
}
