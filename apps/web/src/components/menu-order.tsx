"use client";

import { useState } from "react";

export interface MenuItemData {
  id: string;
  name: Record<string, string>;
  priceCents: number;
  available: boolean;
}

export interface MenuCategoryData {
  category: { id: string; name: Record<string, string> };
  items: MenuItemData[];
}

export interface CartItem {
  menuItemId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

interface MenuOrderProps {
  menu: MenuCategoryData[];
  onSubmit: (items: CartItem[], customerName: string) => Promise<void>;
  title: string;
  subtitle?: string;
}

export default function MenuOrder({ menu, onSubmit, title, subtitle }: MenuOrderProps) {
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [customerName, setCustomerName] = useState("");
  const [step, setStep] = useState<"menu" | "checkout" | "done">("menu");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const cartItems = Object.values(cart).filter((i) => i.quantity > 0);
  const total = cartItems.reduce((s, i) => s + i.priceCents * i.quantity, 0);

  function adjust(item: MenuItemData, delta: number) {
    setCart((prev) => {
      const current = prev[item.id]?.quantity ?? 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [item.id]: {
          menuItemId: item.id,
          name: item.name.en ?? Object.values(item.name)[0],
          priceCents: item.priceCents,
          quantity: next,
        },
      };
    });
  }

  async function placeOrder() {
    setError("");
    setSubmitting(true);
    try {
      await onSubmit(cartItems, customerName);
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow p-8 text-center max-w-sm w-full">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Order placed!</h2>
          <p className="text-gray-500 text-sm">We'll prepare your order shortly.</p>
          <button
            onClick={() => { setStep("menu"); setCart({}); setCustomerName(""); }}
            className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Order again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 py-4">
          <h1 className="text-lg font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
      </div>

      {step === "menu" && (
        <div className="max-w-xl mx-auto px-4 py-4 pb-32">
          {menu.map(({ category, items }) => (
            <div key={category.id} className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {category.name.en ?? Object.values(category.name)[0]}
              </h2>
              <div className="space-y-3">
                {items.map((item) => {
                  const qty = cart[item.id]?.quantity ?? 0;
                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-gray-900 text-sm">
                          {item.name.en ?? Object.values(item.name)[0]}
                        </p>
                        <p className="text-sm text-gray-500">
                          ${(item.priceCents / 100).toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {qty > 0 && (
                          <>
                            <button
                              onClick={() => adjust(item, -1)}
                              className="w-8 h-8 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center font-bold hover:bg-gray-200"
                            >
                              −
                            </button>
                            <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                          </>
                        )}
                        <button
                          onClick={() => adjust(item, 1)}
                          className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold hover:bg-blue-700"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <p className="text-sm text-gray-400">No items available in this category.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {step === "checkout" && (
        <div className="max-w-xl mx-auto px-4 py-4 pb-32">
          <h2 className="font-semibold text-gray-900 mb-4">Your order</h2>
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100 mb-4">
            {cartItems.map((item) => (
              <div key={item.menuItemId} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-gray-700">
                  {item.quantity}× {item.name}
                </span>
                <span className="text-gray-500">
                  ${((item.priceCents * item.quantity) / 100).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-3 text-sm font-semibold">
              <span>Total</span>
              <span>${(total / 100).toFixed(2)}</span>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Alice"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        </div>
      )}

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4">
        <div className="max-w-xl mx-auto">
          {step === "menu" ? (
            <button
              disabled={cartItems.length === 0}
              onClick={() => setStep("checkout")}
              className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-40 hover:bg-blue-700"
            >
              {cartItems.length === 0
                ? "Add items to order"
                : `View order · ${cartItems.reduce((s, i) => s + i.quantity, 0)} items · $${(total / 100).toFixed(2)}`}
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setStep("menu")}
                className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3 font-semibold hover:bg-gray-50"
              >
                Back
              </button>
              <button
                disabled={!customerName.trim() || submitting}
                onClick={placeOrder}
                className="flex-1 bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-40 hover:bg-blue-700"
              >
                {submitting ? "Placing order..." : "Place order"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
