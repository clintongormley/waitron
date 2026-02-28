"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

interface OrderItem {
  id: string;
  menuItemId: string;
  quantity: number;
  unitPriceCents: number;
}

interface Order {
  id: string;
  type: "dine_in" | "takeaway";
  status: string;
  customerName?: string;
  totalCents: number;
  tableId?: string;
  items: OrderItem[];
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  preparing: "bg-orange-100 text-orange-800",
  ready: "bg-purple-100 text-purple-800",
  served: "bg-green-100 text-green-800",
  paid: "bg-gray-100 text-gray-500",
};

const STATUSES = ["pending", "confirmed", "preparing", "ready", "served", "paid"];

export default function OrdersPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = use(params);
  const [statusFilter, setStatusFilter] = useState("");
  const url = `/locations/${locationId}/orders${statusFilter ? `?status=${statusFilter}` : ""}`;
  const { data: orders, mutate } = useSWR<Order[]>(url, fetcher, {
    refreshInterval: 10_000,
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  async function updateStatus(orderId: string, status: string) {
    await api.patch(`/locations/${locationId}/orders/${orderId}/status`, { status });
    mutate();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {orders?.map((order) => (
          <div key={order.id} className="bg-white rounded-lg shadow">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left"
              onClick={() => setExpanded(expanded === order.id ? null : order.id)}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700"
                  }`}
                >
                  {order.status}
                </span>
                <span className="text-sm font-medium text-gray-900">
                  {order.customerName ?? (order.type === "dine_in" ? "Dine-in" : "Takeaway")}
                </span>
                <span className="text-xs text-gray-500 capitalize">{order.type.replace("_", " ")}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-semibold text-gray-900">
                  ${(order.totalCents / 100).toFixed(2)}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(order.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </button>

            {expanded === order.id && (
              <div className="border-t border-gray-100 px-5 py-4">
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-2">Items</p>
                  <ul className="space-y-1">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between text-sm">
                        <span className="text-gray-700">
                          {item.quantity}× item
                        </span>
                        <span className="text-gray-500">
                          ${(item.unitPriceCents / 100).toFixed(2)} ea
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Move to:</span>
                  {STATUSES.filter((s) => s !== order.status).map((s) => (
                    <button
                      key={s}
                      onClick={() => updateStatus(order.id, s)}
                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {orders?.length === 0 && (
          <p className="text-gray-500 text-sm">No orders found.</p>
        )}
      </div>
    </div>
  );
}
