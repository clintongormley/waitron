"use client";

import { use } from "react";
import useSWR from "swr";
import MenuOrder, { type CartItem, type MenuCategoryData } from "@/components/menu-order";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function publicFetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

interface TableData {
  table: { id: string; number: string };
  location: { id: string; name: string };
  menu: MenuCategoryData[];
}

export default function QROrderPage({
  params,
}: {
  params: Promise<{ qrId: string }>;
}) {
  const { qrId } = use(params);
  const { data, error } = useSWR<TableData>(
    `${API_BASE}/table/${qrId}`,
    publicFetcher,
  );

  async function placeOrder(items: CartItem[], customerName: string) {
    const res = await fetch(`${API_BASE}/table/${qrId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName,
        items: items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? "Order failed");
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-2xl mb-2">🍽️</p>
          <p className="text-gray-600">Table not found. Please scan the QR code again.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading menu...</p>
      </div>
    );
  }

  return (
    <MenuOrder
      menu={data.menu}
      onSubmit={placeOrder}
      title={data.location.name}
      subtitle={`Table ${data.table.number}`}
    />
  );
}
