"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadAuth, clearAuth } from "@/lib/auth";
import { IC, Ico } from "@/components/icons";
import type { User, UserRole } from "@/lib/types";

const ROLE_LABELS: Record<UserRole, string> = {
  uploader: "Uploader",
  editor: "Editor",
  curator: "Curador",
  publisher: "Publicador",
  admin: "Administrador",
};

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PerfilPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const { user: stored } = loadAuth();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
    const t = (localStorage.getItem("wf_theme") as "dark" | "light" | null) ?? "dark";
    setTheme(t);
  }, [router]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("wf_theme", next);
  }

  function handleLogout() {
    clearAuth();
    router.push("/");
  }

  if (!user) return null;

  return (
    <div className="page-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "28px 28px 40px" }}>
      <h2 className="ds-title" style={{ marginBottom: 20 }}>Perfil</h2>

      {/* Cartão do usuário */}
      <div className="ds-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: 18, marginBottom: 20 }}>
        <div className="ds-avatar" style={{ width: 52, height: 52, fontSize: 18 }}>{initials(user.username)}</div>
        <div style={{ minWidth: 0 }}>
          <p className="ds-text-primary" style={{ fontSize: 16, fontWeight: 700 }}>{user.username}</p>
          <p className="ds-text-muted" style={{ fontSize: 13 }}>{ROLE_LABELS[user.role] ?? user.role}</p>
        </div>
      </div>

      {/* Trocar tema */}
      <button
        onClick={toggleTheme}
        className="ds-card ds-row-hover"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 16, marginBottom: 12, cursor: "pointer", textAlign: "left" }}
      >
        <Ico d={theme === "dark" ? IC.sun : IC.moon} size={20} />
        <span className="ds-text-primary" style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
          {theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
        </span>
        <Ico d={IC.chevR} size={18} />
      </button>

      {/* Sair */}
      <button
        onClick={handleLogout}
        className="ds-btn ds-btn-danger"
        style={{ width: "100%", padding: "12px 16px", gap: 8 }}
      >
        <Ico d={IC.logout} size={16} /> Sair da conta
      </button>
    </div>
  );
}
