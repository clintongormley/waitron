"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

interface Booking {
  id: string;
  customerName: string;
  customerEmail?: string;
  partySize: number;
  datetime: string;
  durationMinutes: number;
  status: string;
  notes?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  seated: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-500",
  no_show: "bg-red-100 text-red-800",
};

const STATUSES = ["pending", "confirmed", "seated", "cancelled", "no_show"];

export default function BookingsPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = use(params);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: bookings, mutate } = useSWR<Booking[]>(
    `/locations/${locationId}/bookings?date=${date}`,
    fetcher,
  );

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    partySize: "2",
    datetime: `${date}T19:00`,
    durationMinutes: "90",
    notes: "",
  });

  function setField(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function createBooking(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/locations/${locationId}/bookings`, {
      customerName: form.customerName,
      customerEmail: form.customerEmail || undefined,
      partySize: parseInt(form.partySize, 10),
      datetime: new Date(form.datetime).toISOString(),
      durationMinutes: parseInt(form.durationMinutes, 10),
      notes: form.notes || undefined,
    });
    setShowForm(false);
    mutate();
  }

  async function updateStatus(bookingId: string, status: string) {
    await api.patch(`/locations/${locationId}/bookings/${bookingId}/status`, { status });
    mutate();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            {showForm ? "Cancel" : "New booking"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={createBooking} className="bg-white rounded-lg shadow p-4 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                value={form.customerName}
                onChange={setField("customerName")}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.customerEmail}
                onChange={setField("customerEmail")}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Party size</label>
              <input
                type="number"
                min="1"
                value={form.partySize}
                onChange={setField("partySize")}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date & time *</label>
              <input
                type="datetime-local"
                value={form.datetime}
                onChange={setField("datetime")}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (mins)</label>
              <input
                type="number"
                min="30"
                step="30"
                value={form.durationMinutes}
                onChange={setField("durationMinutes")}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={setField("notes")}
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            Save
          </button>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Time", "Name", "Party", "Duration", "Status", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bookings?.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {new Date(b.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{b.customerName}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{b.partySize}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{b.durationMinutes}m</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      STATUS_COLORS[b.status] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {b.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <select
                    value={b.status}
                    onChange={(e) => updateStatus(b.id, e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {bookings?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-sm text-gray-500 text-center">
                  No bookings for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
