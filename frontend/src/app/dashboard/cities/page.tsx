"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { IC, Ico } from "@/components/icons";
import type { City } from "@/lib/types";

export default function CitiesPage() {
  const router = useRouter();
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [workByCity, setWorkByCity] = useState<Record<number, number>>({});

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) {
      router.replace("/");
      return;
    }
    ApiClient.getCities()
      .then(setCities)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // Editor/Curador/Publicador: contagem de trabalho pendente por cidade (badge)
    if (["editor", "curator", "publisher"].includes(user.role)) {
      ApiClient.getWorkSummary()
        .then((s) => {
          const map: Record<number, number> = {};
          s.cities.forEach((c) => { map[c.city_id] = c.count; });
          setWorkByCity(map);
        })
        .catch(() => {});
    }
  }, [router]);

  const filteredCities = cities.filter((c) =>
    `${c.name} ${c.state}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="page-pad" style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 28px 40px" }}>
      <h2 className="ds-title" style={{ marginBottom: 16 }}>Cidades</h2>

      {error && <p className="ds-alert ds-alert-danger" style={{ marginBottom: 12 }}>{error}</p>}
      {loading && <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>}

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
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="ds-text-primary" style={{ fontSize: 14, fontWeight: 700 }}>{city.name}</p>
                <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 1 }}>{city.state}</p>
              </div>
              {workByCity[city.id] > 0 && (
                <span className="ds-badge ds-badge-danger" title="Trabalho pendente" style={{ flexShrink: 0 }}>{workByCity[city.id]}</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--brand-secondary)", marginTop: 14, fontWeight: 600 }}>
              {city.active_event_count} evento{city.active_event_count !== 1 ? "s" : ""} ativo{city.active_event_count !== 1 ? "s" : ""}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
