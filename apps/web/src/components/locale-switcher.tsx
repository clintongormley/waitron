"use client";

import { useTransition } from "react";
import { locales, type Locale } from "@/i18n/config";

const LABELS: Record<Locale, string> = { en: "EN", fr: "FR" };

export default function LocaleSwitcher({ current }: { current: Locale }) {
  const [isPending, startTransition] = useTransition();

  function switchLocale(locale: Locale) {
    startTransition(() => {
      document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000`;
      window.location.reload();
    });
  }

  return (
    <div className="flex gap-1">
      {locales.map((locale) => (
        <button
          key={locale}
          disabled={isPending || locale === current}
          onClick={() => switchLocale(locale)}
          className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${
            locale === current
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
