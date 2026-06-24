"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { IC, Ico } from "@/components/icons";
import type { ActiveTask, WorkSummary } from "@/lib/types";

const ROLE_SEGMENT: Record<string, string> = {
  editor: "editor",
  curator: "curator",
  publisher: "publisher",
  uploader: "uploader",
};

const ROLE_LABELS: Record<string, string> = {
  editor: "Editar",
  curator: "Revisar",
  publisher: "Publicar",
  uploader: "Enviar",
};

const ROLE_BADGE: Record<string, string> = {
  editor: "ds-badge-accent",
  curator: "ds-badge-warning",
  publisher: "ds-badge-success",
  uploader: "ds-badge-info",
};

// Papéis que têm fila de trabalho → ganham contador/badges
const WORK_LABEL: Record<string, string> = {
  editor: "para editar",
  curator: "para revisar",
  publisher: "para publicar",
};

function activeTaskLink(task: ActiveTask): string {
  const segment = ROLE_SEGMENT[task.role_type];
  if (!segment) return "/dashboard";
  return `/dashboard/${segment}/${task.city_id}/${task.event_id}`;
}

function firstName(name: string): string {
  return name.trim().split(/[\s._-]+/)[0] || name;
}

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [summary, setSummary] = useState<WorkSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) {
      router.replace("/");
      return;
    }
    if (user.role === "admin") {
      router.replace("/dashboard/admin");
      return;
    }
    setUsername(user.username);
    setRole(user.role);
    if (["editor", "curator", "publisher"].includes(user.role)) {
      ApiClient.getWorkSummary()
        .then(setSummary)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    } else {
      ApiClient.getActiveTasks()
        .then(setActiveTasks)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [router]);

  return (
    <div className="page-pad" style={{ maxWidth: 720, margin: "0 auto", padding: "28px 28px 40px" }}>
      {/* Saudação */}
      <h2 className="ds-title" style={{ marginBottom: 4 }}>
        Olá, {firstName(username)}
      </h2>
      <p className="ds-text-muted" style={{ fontSize: 14, marginBottom: 24 }}>
        {WORK_LABEL[role]
          ? `Você tem ${summary?.total ?? 0} foto${(summary?.total ?? 0) !== 1 ? "s" : ""} ${WORK_LABEL[role]}.`
          : activeTasks.length > 0
          ? `Você tem ${activeTasks.length} tarefa${activeTasks.length !== 1 ? "s" : ""} para fazer.`
          : "O que você quer fazer hoje?"}
      </p>

      {loading && <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>}
      {error && <p className="ds-alert ds-alert-danger" style={{ marginBottom: 16 }}>{error}</p>}

      {/* Contador (editor/curador/publicador): pendentes + eventos ativos */}
      {!loading && WORK_LABEL[role] && summary && (
        <div className="ds-card" style={{ display: "flex", padding: 18, marginBottom: 20 }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <p style={{ fontSize: 30, fontWeight: 800, color: "var(--brand-primary)", lineHeight: 1 }}>{summary.total}</p>
            <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 6 }}>{WORK_LABEL[role]}</p>
          </div>
          <div style={{ width: 1, background: "var(--border-default)", margin: "0 8px" }} />
          <div style={{ flex: 1, textAlign: "center" }}>
            <p style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{summary.active_events}</p>
            <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 6 }}>eventos ativos</p>
          </div>
        </div>
      )}

      {/* Minhas tarefas */}
      {!loading && activeTasks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {activeTasks.map((task) => (
            <Link
              key={task.task_id}
              href={activeTaskLink(task)}
              className="ds-card ds-hover"
              style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, textDecoration: "none" }}
            >
              {task.cloudinary_url ? (
                <img
                  src={task.cloudinary_url}
                  alt={task.filename}
                  style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: "var(--bg-card-muted)" }}
                />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--brand-secondary) 12%, transparent)", color: "var(--brand-secondary)" }}>
                  <Ico d={IC.image} size={22} />
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className={`ds-badge ${ROLE_BADGE[task.role_type] ?? "ds-badge-neutral"}`}>
                  {ROLE_LABELS[task.role_type] ?? task.role_type}
                </span>
                <p className="ds-text-primary" style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 6 }}>{task.event_name}</p>
                <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 2 }}>{task.city_name}</p>
              </div>
              <Ico d={IC.chevR} size={20} />
            </Link>
          ))}
        </div>
      )}

      {/* Começar algo novo (ou caminho guiado quando não há tarefas) */}
      {!loading && !error && (
        <Link
          href="/dashboard/cities"
          className="ds-card ds-hover"
          style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, textDecoration: "none", marginTop: activeTasks.length > 0 ? 20 : 0 }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--brand-primary) 12%, transparent)", color: "var(--brand-primary)" }}>
            <Ico d={IC.city} size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="ds-text-primary" style={{ fontSize: 14, fontWeight: 600 }}>
              {activeTasks.length > 0 ? "Começar algo novo" : "Ver cidades e eventos"}
            </p>
            <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 2 }}>Escolha uma cidade para trabalhar</p>
          </div>
          <Ico d={IC.chevR} size={20} />
        </Link>
      )}
    </div>
  );
}
