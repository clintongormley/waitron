"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
}

interface SidebarProps {
  locationId?: string;
}

export default function Sidebar({ locationId }: SidebarProps) {
  const pathname = usePathname();

  const topNav: NavItem[] = [{ href: "/locations", label: "Locations" }];

  const locationNav: NavItem[] = locationId
    ? [
        { href: `/locations/${locationId}`, label: "Overview" },
        { href: `/locations/${locationId}/tables`, label: "Tables" },
        { href: `/locations/${locationId}/menu`, label: "Menu" },
        { href: `/locations/${locationId}/bookings`, label: "Bookings" },
        { href: `/locations/${locationId}/orders`, label: "Orders" },
        { href: `/locations/${locationId}/kitchen`, label: "Kitchen" },
      ]
    : [];

  function isActive(href: string) {
    return pathname === href;
  }

  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <div className="px-4 py-5 border-b border-gray-700">
        <span className="text-lg font-bold tracking-tight">Waitron</span>
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
                Location
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
          Sign out
        </button>
      </div>
    </aside>
  );
}
