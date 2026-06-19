"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import type { AdminOverview, BottlenecksResponse, City } from "@/lib/types";

const PHASE_LABELS: Record<string, string> = {
  uploaded: "Aguardando edição",
  selected_for_edit: "Em edição",
  pending_review: "Em revisão",
  approved: "Aprovado",
  published: "Publicado",
  rejected_final: "Rejeitado",
};

const PHASE_COLORS: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  selected_for_edit: "bg-blue-100 text-blue-700",
  pending_review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  published: "bg-emerald-100 text-emerald-700",
  rejected_final: "bg-red-100 text-red-700",
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
    Promise.all([
      ApiClient.getAdminOverview(cityFilter),
      ApiClient.getBottlenecks(cityFilter),
    ])
      .then(([ov, bn]) => {
        setOverview(ov);
        setBottlenecks(bn);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cityFilter]);

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-6 py-10">
        <p className="text-sm text-gray-400">Carregando...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-7xl mx-auto px-6 py-10">
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>
      </main>
    );
  }

  const hasBottlenecks = (bottlenecks?.bottlenecks.length ?? 0) > 0;

  return (
    <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Painel Admin</h2>
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={cityFilter ?? ""}
          onChange={(e) => setCityFilter(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">Todas as cidades</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}/{c.state}
            </option>
          ))}
        </select>
      </div>

      {/* Saúde dos scripts */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Saúde dos Scripts
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {overview &&
            Object.entries(overview.script_health).map(([key, health]) => (
              <div
                key={key}
                className={`rounded-xl border p-4 ${
                  health.is_healthy
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-800">
                    {SCRIPT_NAMES[key] ?? key}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      health.is_healthy
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {health.is_healthy ? "OK" : health.last_status ?? "sem execução"}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Última execução: {formatDate(health.last_run)}
                </p>
              </div>
            ))}
        </div>
        {overview && overview.pending_validation_count > 0 && (
          <p className="mt-3 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
            ⚠ {overview.pending_validation_count} evento(s) aguardando validação de localização.{" "}
            <a
              href="/admin/core/event/?status__exact=pending_validation"
              target="_blank"
              className="underline font-medium"
            >
              Ver no admin
            </a>
          </p>
        )}
      </section>

      {/* Gargalos */}
      {hasBottlenecks && (
        <section>
          <h3 className="text-xs font-semibold text-red-500 uppercase tracking-widest mb-3">
            ⚠ Gargalos detectados
          </h3>
          <div className="space-y-2">
            {bottlenecks!.bottlenecks.map((b, i) => (
              <div
                key={i}
                className="flex items-start gap-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{b.filename}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {b.event_name} · {b.city_name}
                    {b.assigned_to && ` · ${b.assigned_to}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      PHASE_COLORS[b.phase] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {PHASE_LABELS[b.phase] ?? b.phase}
                  </span>
                  <p className="text-xs text-red-600 mt-1 font-semibold">
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
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Eventos ativos
        </h3>
        {overview && overview.events.length === 0 && (
          <p className="text-sm text-gray-400">Nenhum evento ativo.</p>
        )}
        <div className="space-y-3">
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
                <div
                  key={event.id}
                  className="bg-white rounded-xl border border-gray-200 px-5 py-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold text-gray-900">{event.name}</p>
                      <p className="text-xs text-gray-500">
                        {event.city_name}
                        {event.event_date && ` · ${event.event_date}`}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">{total} arquivo(s)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        "uploaded",
                        "selected_for_edit",
                        "pending_review",
                        "approved",
                        "published",
                        "rejected_final",
                      ] as const
                    ).map((phase) => {
                      const count = counts[phase];
                      if (count === 0) return null;
                      return (
                        <span
                          key={phase}
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${PHASE_COLORS[phase]}`}
                        >
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
    </main>
  );
}
