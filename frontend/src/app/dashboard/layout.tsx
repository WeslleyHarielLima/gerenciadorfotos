"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth, clearAuth } from "@/lib/auth";
import { User, UserRole } from "@/lib/types";

const ROLE_LABELS: Record<UserRole, string> = {
  uploader: "Uploader",
  editor: "Editor",
  curator: "Curador",
  publisher: "Publicador",
  admin: "Admin",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const { user: stored } = loadAuth();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
  }, [router]);

  function handleLogout() {
    clearAuth();
    router.push("/");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
            Workflow Studio
          </Link>
          {user && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-4">
            {user.role === "admin" && (
              <Link href="/dashboard/admin" className="text-sm text-gray-600 hover:text-blue-600 transition-colors">
                Painel Admin
              </Link>
            )}
            <span className="text-sm text-gray-600">{user.username}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:underline"
            >
              Sair
            </button>
          </div>
        )}
      </header>
      {children}
    </div>
  );
}
