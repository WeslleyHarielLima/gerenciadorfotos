"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { IC, Ico } from "@/components/icons";
import type { ActiveTask, City } from "@/lib/types";

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

function activeTaskLink(task: ActiveTask): string {
  const segment = ROLE_SEGMENT[task.role_type];
  if (!segment) return "/dashboard";
  return `/dashboard/${segment}/${task.city_id}/${task.event_id}`;
}

export default function CitiesPage() {
  const router = useRouter();
  const [cities, setCities] = useState<City[]>([]);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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

    Promise.all([ApiClient.getCities(), ApiClient.getActiveTasks()])
      .then(([c, t]) => {
        setCities(c);
        setActiveTasks(t);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const filteredCities = cities.filter((c) =>
    `${c.name} ${c.state}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="page-pad" style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 28px 40px" }}>
      {/* Em andamento */}
      <section style={{ marginBottom: 36 }}>
        <h3 className="ds-eyebrow" style={{ marginBottom: 12 }}>Em andamento</h3>

        {loading && <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>}
        {!loading && activeTasks.length === 0 && (
          <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhuma tarefa em andamento.</p>
        )}

        {!loading && activeTasks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeTasks.map((task) => (
              <Link
                key={task.task_id}
                href={activeTaskLink(task)}
                className="ds-card ds-row-hover"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textDecoration: "none" }}
              >
                {task.cloudinary_url ? (
                  <img
                    src={task.cloudinary_url}
                    alt={task.filename}
                    style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "var(--bg-card-muted)" }}
                  />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--brand-secondary) 12%, transparent)", color: "var(--brand-secondary)" }}>
                    <Ico d={IC.image} size={18} />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="ds-text-primary" style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.filename}</p>
                  <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 2 }}>{task.event_name} · {task.city_name}</p>
                </div>
                <span className={`ds-badge ${ROLE_BADGE[task.role_type] ?? "ds-badge-neutral"}`}>
                  {ROLE_LABELS[task.role_type] ?? task.role_type}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Cidades */}
      <section>
        <h3 className="ds-eyebrow" style={{ marginBottom: 14 }}>Cidades com trabalho</h3>

        {error && <p className="ds-alert ds-alert-danger" style={{ marginBottom: 12 }}>{error}</p>}

        {!loading && !error && cities.length === 0 && (
          <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhuma cidade com eventos ativos no momento.</p>
        )}

        {/* Campo de busca de cidades */}
        {cities.length > 0 && (
          <div className="ds-input-wrap" style={{ maxWidth: 360, height: 40, padding: "0 12px", marginBottom: 16, gap: 8 }}>
            <Ico d={IC.search} size={16} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cidade..."
              aria-label="Buscar cidade"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit" }}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Limpar busca" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 0 }}>
                <Ico d={IC.close} size={14} />
              </button>
            )}
          </div>
        )}

        {!loading && !error && cities.length > 0 && filteredCities.length === 0 && (
          <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhuma cidade encontrada para “{query}”.</p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {filteredCities.map((city) => (
            <Link
              key={city.id}
              href={`/dashboard/${city.id}`}
              className="ds-card ds-hover"
              style={{ padding: 18, textDecoration: "none", display: "block" }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--brand-primary) 12%, transparent)", color: "var(--brand-primary)" }}>
                  <Ico d={IC.city} size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="ds-text-primary" style={{ fontSize: 14, fontWeight: 700 }}>{city.name}</p>
                  <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 1 }}>{city.state}</p>
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--brand-secondary)", marginTop: 14, fontWeight: 600 }}>
                {city.active_event_count} evento{city.active_event_count !== 1 ? "s" : ""} ativo{city.active_event_count !== 1 ? "s" : ""}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
