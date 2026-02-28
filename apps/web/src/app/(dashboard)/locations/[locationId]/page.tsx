"use client";

import useSWR from "swr";
import Link from "next/link";
import { use } from "react";
import { fetcher } from "@/lib/api";

interface Location {
  id: string;
  name: string;
  address?: string;
  phone?: string;
}

const cards = [
  { label: "Tables", href: "tables", desc: "Manage seating and QR codes" },
  { label: "Menu", href: "menu", desc: "Categories, items, and modifiers" },
  { label: "Bookings", href: "bookings", desc: "Reservations and availability" },
  { label: "Orders", href: "orders", desc: "Active and past orders" },
  { label: "Kitchen", href: "kitchen", desc: "Ticket board and station status" },
];

export default function LocationOverviewPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = use(params);
  const { data: location, error } = useSWR<Location>(
    `/locations/${locationId}`,
    fetcher,
  );

  if (error) return <p className="text-red-600 text-sm">Location not found.</p>;
  if (!location) return <p className="text-gray-500 text-sm">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{location.name}</h1>
      {location.address && <p className="text-gray-500 text-sm mb-6">{location.address}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={`/locations/${locationId}/${card.href}`}
            className="bg-white rounded-lg shadow p-5 hover:shadow-md transition-shadow"
          >
            <h2 className="font-semibold text-gray-900 mb-1">{card.label}</h2>
            <p className="text-sm text-gray-500">{card.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
