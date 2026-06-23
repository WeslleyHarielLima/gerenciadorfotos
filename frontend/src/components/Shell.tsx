"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IC, Ico, LogoMark } from "@/components/icons";
import type { User, UserRole } from "@/lib/types";

const ROLE_LABELS: Record<UserRole, string> = {
  uploader: "Uploader",
  editor: "Editor",
  curator: "Curador",
  publisher: "Publicador",
  admin: "Administrador",
};

type NavItem = { id: string; label: string; href: string; icon: string | string[] };

function navForRole(role: UserRole): NavItem[] {
  const items: NavItem[] = [{ id: "home", label: "Início", href: "/dashboard", icon: IC.home }];
  if (role === "admin") {
    items.push({ id: "admin", label: "Administração", href: "/dashboard/admin", icon: IC.admin });
  }
  return items;
}

/* Título da página a partir da rota — espelha a topbar do modelo */
function titleFromPath(path: string): string {
  if (path.startsWith("/dashboard/admin")) return "Administração";
  if (path.startsWith("/dashboard/uploader")) return "Envio de mídia";
  if (path.startsWith("/dashboard/editor")) return "Edição";
  if (path.startsWith("/dashboard/curator")) return "Revisão";
  if (path.startsWith("/dashboard/publisher")) return "Publicação";
  if (/^\/dashboard\/\d+/.test(path)) return "Eventos";
  return "Início";
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SidebarItem({ item, active, expanded }: { item: NavItem; active: boolean; expanded: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <Link
      href={item.href}
      title={!expanded ? item.label : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: expanded ? 10 : 0,
        justifyContent: expanded ? "flex-start" : "center",
        padding: expanded ? "0 12px" : "0",
        height: 40,
        textDecoration: "none",
        background: active ? "var(--sidebar-active-bg)" : hov ? "var(--sidebar-hover-bg)" : "transparent",
        color: active ? "var(--sidebar-active-text)" : hov ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "background var(--tr), color var(--tr)",
        position: "relative",
      }}
    >
      {active && (
        <div style={{ position: "absolute", left: 0, top: "20%", bottom: "20%", width: 3, borderRadius: "0 3px 3px 0", background: "var(--brand-primary)" }} />
      )}
      <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: active ? "rgba(242,194,48,0.08)" : "transparent" }}>
        <Ico d={item.icon} size={18} />
      </div>
      {expanded && (
        <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, flex: 1, whiteSpace: "nowrap" }}>{item.label}</span>
      )}
    </Link>
  );
}

export default function DashboardShell({
  user,
  onLogout,
  children,
}: {
  user: User;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const nav = navForRole(user.role);
  const W = expanded ? 240 : 72;

  // Fecha a gaveta mobile ao trocar de rota
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const stored = (localStorage.getItem("wf_theme") as "dark" | "light" | null) ?? "dark";
    setTheme(stored);
    document.documentElement.setAttribute("data-theme", stored);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("wf_theme", next);
  }

  return (
    <div className="shell-root">
      {/* ── SIDEBAR ─────────────────────────────────────── */}
      <aside
        className="shell-sidebar"
        data-open={mobileOpen}
        style={{ "--sidebar-w": `${W}px` } as React.CSSProperties}
      >
        {/* Marca */}
        <div
          style={{
            height: 60,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: expanded ? "0 18px" : "0",
            justifyContent: expanded ? "space-between" : "center",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {expanded ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <LogoMark size={30} />
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--brand-primary)", letterSpacing: ".1em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Wiveslando Neiva</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Campanha 2026</div>
                </div>
              </div>
              <button className="shell-collapse-btn" onClick={() => setExpanded(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4, borderRadius: 6, flexShrink: 0 }} aria-label="Recolher menu">
                <Ico d={IC.chevL} size={16} />
              </button>
            </>
          ) : (
            <button onClick={() => setExpanded(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, display: "flex" }} aria-label="Expandir menu">
              <LogoMark size={28} />
            </button>
          )}
        </div>

        {/* Navegação */}
        <nav style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 0" }}>
          {expanded && (
            <div style={{ padding: "10px 20px 4px", fontSize: 10, fontWeight: 600, letterSpacing: ".10em", color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>Operação</div>
          )}
          {nav.map((item) => {
            const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
            return <SidebarItem key={item.id} item={item} active={active} expanded={expanded} />;
          })}
        </nav>

        {/* Usuário + logout */}
        <div
          style={{
            padding: expanded ? "12px" : "12px 6px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: expanded ? 10 : 0,
            justifyContent: expanded ? "flex-start" : "center",
          }}
        >
          <div className="ds-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>{initials(user.username)}</div>
          {expanded && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.username}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{ROLE_LABELS[user.role] ?? user.role}</div>
              </div>
              <button onClick={onLogout} title="Sair" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4, borderRadius: 6 }} aria-label="Sair">
                <Ico d={IC.logout} size={15} />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Overlay da gaveta — só aparece no mobile quando aberta */}
      <div className="shell-overlay" data-open={mobileOpen} onClick={() => setMobileOpen(false)} />

      {/* ── ÁREA PRINCIPAL ──────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Topbar */}
        <header
          style={{
            height: 60,
            flexShrink: 0,
            background: "var(--bg-topbar)",
            backdropFilter: "var(--topbar-blur)",
            WebkitBackdropFilter: "var(--topbar-blur)",
            borderBottom: "1px solid var(--border-default)",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 12,
            zIndex: 20,
          }}
        >
          <button
            className="shell-hamburger"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
            style={{ width: 36, height: 36, background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", borderRadius: 8, marginRight: 2 }}
          >
            <Ico d={IC.menu} size={20} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{titleFromPath(pathname)}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
              style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", borderRadius: 8, transition: "background var(--tr), color var(--tr)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--sidebar-hover-bg)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <Ico d={theme === "dark" ? IC.sun : IC.moon} size={18} />
            </button>
            <div style={{ width: 1, height: 20, background: "var(--border-default)", margin: "0 6px" }} />
            <div className="ds-avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(user.username)}</div>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{user.username}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{ROLE_LABELS[user.role] ?? user.role}</span>
            </div>
          </div>
        </header>

        {/* Conteúdo (cada página renderiza o próprio canvas) */}
        <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-canvas)" }}>{children}</main>
      </div>
    </div>
  );
}
