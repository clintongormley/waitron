"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Sidebar from "@/components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const locationId = params?.locationId as string | undefined;

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar locationId={locationId} />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
