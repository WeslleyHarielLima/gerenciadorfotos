"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadAuth, clearAuth } from "@/lib/auth";
import { User } from "@/lib/types";
import DashboardShell from "@/components/Shell";

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

  if (!user) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-app)" }}>
        <span className="ds-spinner" style={{ borderTopColor: "var(--brand-primary)" }} />
      </div>
    );
  }

  return (
    <DashboardShell user={user} onLogout={handleLogout}>
      {children}
    </DashboardShell>
  );
}
