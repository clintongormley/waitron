"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";

interface MenuItem {
  id: string;
  name: Record<string, string>;
  priceCents: number;
  available: boolean;
}

interface MenuCategory {
  id: string;
  name: Record<string, string>;
  sortOrder: number;
  items: MenuItem[];
}

export default function MenuPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = use(params);
  const { data: categories, mutate } = useSWR<MenuCategory[]>(
    `/locations/${locationId}/menu-categories`,
    fetcher,
  );

  const [newCatName, setNewCatName] = useState("");
  const [showCatForm, setShowCatForm] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/locations/${locationId}/menu-categories`, {
      name: { en: newCatName },
      sortOrder: (categories?.length ?? 0) + 1,
    });
    setNewCatName("");
    setShowCatForm(false);
    mutate();
  }

  async function createItem(e: React.FormEvent, categoryId: string) {
    e.preventDefault();
    await api.post(`/locations/${locationId}/menu-categories/${categoryId}/menu-items`, {
      name: { en: newItemName },
      priceCents: Math.round(parseFloat(newItemPrice) * 100),
    });
    setNewItemName("");
    setNewItemPrice("");
    mutate();
  }

  async function toggleAvailability(categoryId: string, itemId: string, current: boolean) {
    await api.patch(
      `/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/availability`,
      { available: !current },
    );
    mutate();
  }

  async function deleteItem(categoryId: string, itemId: string) {
    if (!confirm("Delete this item?")) return;
    await api.delete(
      `/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}`,
    );
    mutate();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
        <button
          onClick={() => setShowCatForm((v) => !v)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          {showCatForm ? "Cancel" : "Add category"}
        </button>
      </div>

      {showCatForm && (
        <form onSubmit={createCategory} className="bg-white rounded-lg shadow p-4 mb-6 flex gap-3">
          <input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="Category name"
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

      <div className="space-y-4">
        {categories?.map((cat) => (
          <div key={cat.id} className="bg-white rounded-lg shadow">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left"
              onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)}
            >
              <span className="font-semibold text-gray-900">{cat.name.en}</span>
              <span className="text-sm text-gray-500">{cat.items?.length ?? 0} items</span>
            </button>

            {expandedCat === cat.id && (
              <div className="border-t border-gray-100">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      {["Name", "Price", "Status", ""].map((h) => (
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
                    {cat.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 text-sm text-gray-900">{item.name.en}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          ${(item.priceCents / 100).toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleAvailability(cat.id, item.id, item.available)}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              item.available
                                ? "bg-green-100 text-green-800 hover:bg-green-200"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            }`}
                          >
                            {item.available ? "Available" : "Unavailable"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => deleteItem(cat.id, item.id)}
                            className="text-xs text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <form
                  onSubmit={(e) => createItem(e, cat.id)}
                  className="flex gap-2 p-4 bg-gray-50 border-t border-gray-100"
                >
                  <input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="Item name"
                    required
                    className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    placeholder="Price"
                    required
                    className="w-24 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700"
                  >
                    Add
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}

        {categories?.length === 0 && (
          <p className="text-gray-500 text-sm">No menu categories yet.</p>
        )}
      </div>
    </div>
  );
}
