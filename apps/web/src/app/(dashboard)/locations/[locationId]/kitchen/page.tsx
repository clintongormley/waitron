"use client";

import { use, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

interface KitchenStation {
  id: string;
  name: string;
}

interface KitchenTicket {
  id: string;
  orderId: string;
  stationId: string;
  status: "pending" | "in_progress" | "ready" | "bumped";
  priority: number;
  startedAt?: string;
  completedAt?: string;
}

const TICKET_COLORS: Record<string, string> = {
  pending: "border-yellow-400 bg-yellow-50",
  in_progress: "border-orange-400 bg-orange-50",
  ready: "border-green-400 bg-green-50",
  bumped: "border-gray-300 bg-gray-50",
};

const NEXT_STATUS: Record<string, string> = {
  pending: "in_progress",
  in_progress: "ready",
  ready: "bumped",
};

export default function KitchenPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = use(params);
  const { data: stations } = useSWR<KitchenStation[]>(
    `/locations/${locationId}/kitchen/stations`,
    fetcher,
  );
  const { data: tickets, mutate } = useSWR<KitchenTicket[]>(
    `/locations/${locationId}/kitchen/tickets?status=pending,in_progress,ready`,
    fetcher,
    { refreshInterval: 5_000 },
  );

  const [showStationForm, setShowStationForm] = useState(false);
  const [stationName, setStationName] = useState("");

  async function createStation(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/locations/${locationId}/kitchen/stations`, { name: stationName });
    setStationName("");
    setShowStationForm(false);
    mutate();
  }

  async function advanceTicket(ticketId: string, currentStatus: string) {
    const next = NEXT_STATUS[currentStatus];
    if (!next) return;
    await api.patch(`/locations/${locationId}/kitchen/tickets/${ticketId}/status`, {
      status: next,
    });
    mutate();
  }

  const stationMap = Object.fromEntries(
    (stations ?? []).map((s) => [s.id, s.name]),
  );

  const ticketsByStation = (stations ?? []).map((station) => ({
    station,
    tickets: (tickets ?? []).filter((t) => t.stationId === station.id),
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Kitchen Display</h1>
        <button
          onClick={() => setShowStationForm((v) => !v)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          {showStationForm ? "Cancel" : "Add station"}
        </button>
      </div>

      {showStationForm && (
        <form onSubmit={createStation} className="bg-white rounded-lg shadow p-4 mb-6 flex gap-3">
          <input
            value={stationName}
            onChange={(e) => setStationName(e.target.value)}
            placeholder="Station name (e.g. Grill, Fryer)"
            required
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            Save
          </button>
        </form>
      )}

      {ticketsByStation.length === 0 && (
        <p className="text-gray-500 text-sm">No stations yet. Add a station to start routing tickets.</p>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ticketsByStation.map(({ station, tickets: stationTickets }) => (
          <div key={station.id} className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{station.name}</h2>
              <p className="text-xs text-gray-500">{stationTickets.length} active tickets</p>
            </div>
            <div className="p-3 space-y-2">
              {stationTickets.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">No tickets</p>
              )}
              {stationTickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`border-l-4 rounded p-3 ${TICKET_COLORS[ticket.status]}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-700">
                      Order #{ticket.orderId.slice(-6).toUpperCase()}
                    </span>
                    <span className="text-xs capitalize text-gray-500">
                      {ticket.status.replace("_", " ")}
                    </span>
                  </div>
                  {NEXT_STATUS[ticket.status] && (
                    <button
                      onClick={() => advanceTicket(ticket.id, ticket.status)}
                      className="w-full text-xs bg-white border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 font-medium"
                    >
                      → {NEXT_STATUS[ticket.status].replace("_", " ")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {(tickets ?? []).filter((t) => !stationMap[t.stationId]).length > 0 && (
        <div className="mt-6 bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Unassigned tickets</h2>
          <p className="text-sm text-gray-500">
            Some tickets belong to stations not in this location.
          </p>
        </div>
      )}
    </div>
  );
}
