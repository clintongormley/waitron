"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { logout } from "@/lib/auth";
import LocaleSwitcher from "./locale-switcher";
import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";

interface NavItem {
  href: string;
  label: string;
}

interface SidebarProps {
  locationId?: string;
}

export default function Sidebar({ locationId }: SidebarProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth");
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    const match = document.cookie.match(/NEXT_LOCALE=([^;]+)/);
    if (match) setLocale(match[1] as Locale);
  }, []);

  const topNav: NavItem[] = [{ href: "/locations", label: t("locations") }];

  const locationNav: NavItem[] = locationId
    ? [
        { href: `/locations/${locationId}`, label: t("overview") },
        { href: `/locations/${locationId}/tables`, label: t("tables") },
        { href: `/locations/${locationId}/menu`, label: t("menu") },
        { href: `/locations/${locationId}/bookings`, label: t("bookings") },
        { href: `/locations/${locationId}/orders`, label: t("orders") },
        { href: `/locations/${locationId}/kitchen`, label: t("kitchen") },
      ]
    : [];

  function isActive(href: string) {
    return pathname === href;
  }

  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <div className="px-4 py-5 border-b border-gray-700 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">Waitron</span>
        <LocaleSwitcher current={locale} />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {topNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive(item.href)
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        ))}

        {locationNav.length > 0 && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t("location")}
              </p>
            </div>
            {locationNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="px-3 py-4 border-t border-gray-700">
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 rounded-md text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          {tAuth("signOut")}
        </button>
      </div>
    </aside>
  );
}
