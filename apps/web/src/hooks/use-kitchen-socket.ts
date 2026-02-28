"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface KitchenTicket {
  id: string;
  orderId: string;
  stationId: string;
  status: "pending" | "in_progress" | "ready" | "bumped";
  priority: number;
  startedAt?: string;
  completedAt?: string;
}

export function useKitchenSocket(locationId: string) {
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const socketRef = useRef<Socket | null>(null);

  function upsertTicket(ticket: KitchenTicket) {
    setTickets((prev) => {
      const idx = prev.findIndex((t) => t.id === ticket.id);
      if (idx === -1) return [...prev, ticket];
      const next = [...prev];
      next[idx] = ticket;
      return next;
    });
  }

  useEffect(() => {
    const socket = io(API_BASE, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("ticket.created", (data: KitchenTicket) => {
      // Only track tickets for this location (tickets carry orderId not locationId,
      // so we show all for now and filter by stationId after stations load)
      upsertTicket(data);
    });

    socket.on("ticket.started", (data: KitchenTicket) => {
      upsertTicket(data);
    });

    socket.on("ticket.ready", (data: KitchenTicket) => {
      upsertTicket(data);
    });

    socket.on("order.updated", (data: { id: string; status: string }) => {
      // If order is paid/served, remove its tickets from the board
      if (data.status === "paid" || data.status === "served") {
        setTickets((prev) => prev.filter((t) => t.orderId !== data.id));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [locationId]);

  function advanceTicket(ticketId: string) {
    setTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;
        const next =
          t.status === "pending"
            ? "in_progress"
            : t.status === "in_progress"
              ? "ready"
              : "bumped";
        return { ...t, status: next as KitchenTicket["status"] };
      }),
    );
  }

  const activeTickets = tickets.filter((t) => t.status !== "bumped");

  return { tickets: activeTickets, advanceTicket };
}
