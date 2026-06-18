"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { loadAuth, clearAuth } from "@/lib/auth";
import { UserRole } from "@/lib/types";

const ROLE_LABELS: Record<UserRole, string> = {
  uploader: "Uploader",
  editor: "Editor",
  curator: "Curador",
  publisher: "Publicador",
  admin: "Admin",
};

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams();
  const role = params.role as UserRole;
  const [username, setUsername] = useState("");

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) {
      router.replace("/");
      return;
    }
    if (user.role !== role) {
      router.replace(`/dashboard/${user.role}`);
      return;
    }
    setUsername(user.username);
  }, [role, router]);

  function handleLogout() {
    clearAuth();
    router.push("/");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="font-semibold text-gray-900">Workflow Studio</span>
          <span className="ml-3 text-sm text-gray-500">
            {ROLE_LABELS[role] ?? role}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{username}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-600 hover:underline"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Dashboard</h2>
        <p className="text-gray-500 text-sm">
          Bem-vindo, <strong>{username}</strong>. Suas cidades e eventos com trabalho pendente aparecerão aqui.
        </p>
      </main>
    </div>
  );
}
