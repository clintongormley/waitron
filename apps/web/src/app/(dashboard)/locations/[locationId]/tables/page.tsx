"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

interface Table {
  id: string;
  number: string;
  capacity: number;
  qrCodeId: string;
  available: boolean;
}

export default function TablesPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = use(params);
  const { data: tables, mutate, error } = useSWR<Table[]>(
    `/locations/${locationId}/tables`,
    fetcher,
  );
  const [showForm, setShowForm] = useState(false);
  const [number, setNumber] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [saving, setSaving] = useState(false);

  async function createTable(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/locations/${locationId}/tables`, {
        number,
        capacity: parseInt(capacity, 10),
      });
      setNumber("");
      setCapacity("4");
      setShowForm(false);
      mutate();
    } finally {
      setSaving(false);
    }
  }

  async function deleteTable(id: string) {
    if (!confirm("Delete this table?")) return;
    await api.delete(`/locations/${locationId}/tables/${id}`);
    mutate();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "Add table"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createTable} className="bg-white rounded-lg shadow p-4 mb-6 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Table #</label>
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
              <input
                type="number"
                min="1"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      {error && <p className="text-red-600 text-sm">Failed to load tables.</p>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Table #", "Capacity", "QR Code", "Status", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tables?.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.number}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{t.capacity}</td>
                <td className="px-4 py-3 text-sm text-gray-500 font-mono text-xs">{t.qrCodeId}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      t.available
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {t.available ? "Available" : "Occupied"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => deleteTable(t.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {tables?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm text-gray-500 text-center">
                  No tables yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
