"use client";

import { use } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useKitchenSocket } from "@/hooks/use-kitchen-socket";

interface KitchenStation {
  id: string;
  name: string;
}

const TICKET_STYLES: Record<string, { border: string; bg: string; label: string }> = {
  pending: { border: "border-yellow-400", bg: "bg-yellow-50", label: "Pending" },
  in_progress: { border: "border-orange-500", bg: "bg-orange-50", label: "In progress" },
  ready: { border: "border-green-500", bg: "bg-green-50", label: "Ready" },
};

const NEXT_ACTION: Record<string, string> = {
  pending: "Start",
  in_progress: "Mark ready",
  ready: "Bump",
};

export default function KitchenDisplayPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = use(params);
  const { data: stations } = useSWR<KitchenStation[]>(
    `/locations/${locationId}/kitchen/stations`,
    fetcher,
    { refreshInterval: 30_000 },
  );

  const { tickets, advanceTicket } = useKitchenSocket(locationId);

  async function handleAdvance(ticketId: string, currentStatus: string) {
    // Optimistic local update
    advanceTicket(ticketId);

    const next =
      currentStatus === "pending"
        ? "in_progress"
        : currentStatus === "in_progress"
          ? "ready"
          : "bumped";

    try {
      await api.patch(`/locations/${locationId}/kitchen/tickets/${ticketId}/status`, {
        status: next,
      });
    } catch {
      // On failure the socket will not emit an update, local state stays
    }
  }

  const stationMap = Object.fromEntries(
    (stations ?? []).map((s) => [s.id, s.name]),
  );

  const allStationIds = [...new Set(tickets.map((t) => t.stationId))];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Kitchen Display</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-yellow-400" /> Pending
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-orange-500" /> In progress
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-green-500" /> Ready
          </span>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">Waiting for orders...</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {allStationIds.map((stationId) => {
            const stationTickets = tickets.filter((t) => t.stationId === stationId);
            if (stationTickets.length === 0) return null;

            return (
              <div key={stationId} className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  {stationMap[stationId] ?? "Station"}
                </h2>
                {stationTickets.map((ticket) => {
                  const style = TICKET_STYLES[ticket.status] ?? TICKET_STYLES.pending;
                  const action = NEXT_ACTION[ticket.status];
                  return (
                    <div
                      key={ticket.id}
                      className={`border-l-4 ${style.border} ${style.bg} rounded-lg p-4 text-gray-900`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-bold text-sm">
                            #{ticket.orderId.slice(-6).toUpperCase()}
                          </p>
                          <p className="text-xs text-gray-500">{style.label}</p>
                        </div>
                        {ticket.startedAt && (
                          <p className="text-xs text-gray-500">
                            {Math.round(
                              (Date.now() - new Date(ticket.startedAt).getTime()) / 60000,
                            )}
                            m
                          </p>
                        )}
                      </div>
                      {action && action !== "Bump" && (
                        <button
                          onClick={() => handleAdvance(ticket.id, ticket.status)}
                          className="w-full text-sm font-semibold bg-white border border-gray-300 rounded-lg py-2 hover:bg-gray-50 transition-colors"
                        >
                          {action}
                        </button>
                      )}
                      {action === "Bump" && (
                        <button
                          onClick={() => handleAdvance(ticket.id, ticket.status)}
                          className="w-full text-sm font-semibold bg-gray-800 text-white rounded-lg py-2 hover:bg-gray-700 transition-colors"
                        >
                          Bump
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
