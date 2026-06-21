"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { IC, Ico } from "@/components/icons";
import type { AdminOverview, BottlenecksResponse, City } from "@/lib/types";

const PHASE_LABELS: Record<string, string> = {
  uploaded: "Aguardando edição",
  selected_for_edit: "Em edição",
  pending_review: "Em revisão",
  approved: "Aprovado",
  published: "Publicado",
  rejected_final: "Rejeitado",
};

const PHASE_BADGE: Record<string, string> = {
  uploaded: "ds-badge-neutral",
  selected_for_edit: "ds-badge-info",
  pending_review: "ds-badge-warning",
  approved: "ds-badge-success",
  published: "ds-badge-success",
  rejected_final: "ds-badge-danger",
};

const SCRIPT_NAMES: Record<string, string> = {
  calendar_sync: "Sync Calendar",
  backup: "Backup",
  drive_cleanup: "Limpeza Drive",
};

function formatDate(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHours(h: number): string {
  if (h < 24) return `${h}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [bottlenecks, setBottlenecks] = useState<BottlenecksResponse | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [cityFilter, setCityFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const { user } = loadAuth();
    if (!user || user.role !== "admin") {
      router.replace("/dashboard");
      return;
    }
    ApiClient.getCities().then(setCities).catch(() => {});
  }, [router]);

  useEffect(() => {
    setLoading(true);
    Promise.all([ApiClient.getAdminOverview(cityFilter), ApiClient.getBottlenecks(cityFilter)])
      .then(([ov, bn]) => {
        setOverview(ov);
        setBottlenecks(bn);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cityFilter]);

  if (loading) {
    return (
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 40px" }}>
        <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 40px" }}>
        <p className="ds-alert ds-alert-danger">{error}</p>
      </div>
    );
  }

  const hasBottlenecks = (bottlenecks?.bottlenecks.length ?? 0) > 0;

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 40px", display: "flex", flexDirection: "column", gap: 36 }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <h2 className="ds-title">Painel Admin</h2>
        <select
          className="ds-select"
          value={cityFilter ?? ""}
          onChange={(e) => setCityFilter(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">Todas as cidades</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}/{c.state}</option>
          ))}
        </select>
      </div>

      {/* Saúde dos scripts */}
      <section>
        <h3 className="ds-eyebrow" style={{ marginBottom: 12 }}>Saúde dos Scripts</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {overview &&
            Object.entries(overview.script_health).map(([key, health]) => (
              <div
                key={key}
                className="ds-card"
                style={{ padding: 16, borderColor: health.is_healthy ? "color-mix(in srgb, var(--state-success) 28%, transparent)" : "color-mix(in srgb, var(--state-danger) 28%, transparent)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="ds-text-primary" style={{ fontSize: 13, fontWeight: 600 }}>{SCRIPT_NAMES[key] ?? key}</span>
                  <span className={`ds-badge ${health.is_healthy ? "ds-badge-success" : "ds-badge-danger"}`}>
                    {health.is_healthy ? "OK" : health.last_status ?? "sem execução"}
                  </span>
                </div>
                <p className="ds-text-muted" style={{ fontSize: 12 }}>Última execução: {formatDate(health.last_run)}</p>
              </div>
            ))}
        </div>
        {overview && overview.pending_validation_count > 0 && (
          <p className="ds-alert ds-alert-warning" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Ico d={IC.alert} size={15} />
            {overview.pending_validation_count} evento(s) aguardando validação de localização.{" "}
            <a href="/admin/core/event/?status__exact=pending_validation" target="_blank" style={{ textDecoration: "underline", fontWeight: 600, color: "inherit" }}>
              Ver no admin
            </a>
          </p>
        )}
      </section>

      {/* Gargalos */}
      {hasBottlenecks && (
        <section>
          <h3 className="ds-eyebrow" style={{ marginBottom: 12, color: "var(--state-danger)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico d={IC.alert} size={13} /> Gargalos detectados</span>
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {bottlenecks!.bottlenecks.map((b, i) => (
              <div
                key={i}
                className="ds-card"
                style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "12px 16px", borderColor: "color-mix(in srgb, var(--state-danger) 26%, transparent)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="ds-text-primary" style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.filename}</p>
                  <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {b.event_name} · {b.city_name}{b.assigned_to && ` · ${b.assigned_to}`}
                  </p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span className={`ds-badge ${PHASE_BADGE[b.phase] ?? "ds-badge-neutral"}`}>{PHASE_LABELS[b.phase] ?? b.phase}</span>
                  <p style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: "var(--state-danger)" }}>
                    {formatHours(b.hours_stuck)} parado (limite: {formatHours(b.threshold_hours)})
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Visão geral de eventos */}
      <section>
        <h3 className="ds-eyebrow" style={{ marginBottom: 12 }}>Eventos ativos</h3>
        {overview && overview.events.length === 0 && (
          <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhum evento ativo.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {overview &&
            overview.events.map((event) => {
              const { counts } = event;
              const total =
                counts.uploaded +
                counts.selected_for_edit +
                counts.pending_review +
                counts.approved +
                counts.published +
                counts.rejected_final;
              return (
                <div key={event.id} className="ds-card" style={{ padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
                    <div>
                      <p className="ds-text-primary" style={{ fontSize: 14, fontWeight: 700 }}>{event.name}</p>
                      <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 1 }}>
                        {event.city_name}{event.event_date && ` · ${event.event_date}`}
                      </p>
                    </div>
                    <span className="ds-text-muted" style={{ fontSize: 12, flexShrink: 0 }}>{total} arquivo(s)</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(["uploaded", "selected_for_edit", "pending_review", "approved", "published", "rejected_final"] as const).map((phase) => {
                      const count = counts[phase];
                      if (count === 0) return null;
                      return (
                        <span key={phase} className={`ds-badge ${PHASE_BADGE[phase]}`}>
                          {PHASE_LABELS[phase]}: {count}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}
