"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher, api } from "@/lib/api";

interface Location {
  id: string;
  name: string;
  address?: string;
  phone?: string;
}

export default function LocationsPage() {
  const { data: locations, mutate, error } = useSWR<Location[]>("/locations", fetcher);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  async function createLocation(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/locations", { name, address: address || undefined });
      setName("");
      setAddress("");
      setShowForm(false);
      mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "Add location"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={createLocation}
          className="bg-white rounded-lg shadow p-4 mb-6 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
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

      {error && <p className="text-red-600 text-sm">Failed to load locations.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {locations?.map((loc) => (
          <Link
            key={loc.id}
            href={`/locations/${loc.id}`}
            className="bg-white rounded-lg shadow p-5 hover:shadow-md transition-shadow"
          >
            <h2 className="font-semibold text-gray-900">{loc.name}</h2>
            {loc.address && <p className="text-sm text-gray-500 mt-1">{loc.address}</p>}
          </Link>
        ))}
        {locations?.length === 0 && (
          <p className="text-gray-500 text-sm col-span-3">No locations yet. Add one to get started.</p>
        )}
      </div>
    </div>
  );
}
