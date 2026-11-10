import type { ReactiveControllerHost } from "lit";
import { ChangeObserver } from "@waitron/ui";
import { subscribeLocale } from "./t.js";

export class LocaleChangeController extends ChangeObserver {
  constructor(host: ReactiveControllerHost, handler?: () => void) {
    super(host, subscribeLocale, handler);
  }
}
