"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

interface Stats {
  tenants: number;
  users: number;
  locations: number;
  orders: number;
  bookings: number;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      router.replace("/login");
    }
  }, [router]);

  const { data: stats } = useSWR<Stats>("/admin/stats", fetcher);
  const { data: tenants, mutate: mutateTenants } = useSWR<Tenant[]>(
    "/admin/tenants",
    fetcher,
  );
  const { data: tenantUsers } = useSWR<TenantUser[]>(
    selectedTenantId ? `/admin/tenants/${selectedTenantId}/users` : null,
    fetcher,
  );

  async function deleteTenant(id: string, name: string) {
    if (!confirm(`Delete tenant "${name}" and all their data? This cannot be undone.`)) return;
    await api.delete(`/admin/tenants/${id}`);
    mutateTenants();
    if (selectedTenantId === id) setSelectedTenantId(null);
  }

  const statCards = stats
    ? [
        { label: "Tenants", value: stats.tenants },
        { label: "Users", value: stats.users },
        { label: "Locations", value: stats.locations },
        { label: "Orders", value: stats.orders },
        { label: "Bookings", value: stats.bookings },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gray-900 text-white px-6 py-4">
        <h1 className="text-xl font-bold">Waitron Platform Admin</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
          {statCards.map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-sm text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tenants list */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Tenants</h2>
            </div>
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {["Name", "Slug", "Created", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tenants?.map((t) => (
                  <tr
                    key={t.id}
                    className={`cursor-pointer hover:bg-blue-50 ${selectedTenantId === t.id ? "bg-blue-50" : ""}`}
                    onClick={() =>
                      setSelectedTenantId(selectedTenantId === t.id ? null : t.id)
                    }
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono text-xs">
                      {t.slug}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTenant(t.id, t.name);
                        }}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {tenants?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-sm text-gray-400 text-center">
                      No tenants.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tenant users */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">
                {selectedTenantId
                  ? `Users — ${tenants?.find((t) => t.id === selectedTenantId)?.name}`
                  : "Select a tenant to view users"}
              </h2>
            </div>
            {selectedTenantId ? (
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {["Name", "Email", "Role"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tenantUsers?.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{u.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                          {u.role}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {tenantUsers?.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-sm text-gray-400 text-center">
                        No users in this tenant.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                Click a tenant row to view its users.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
