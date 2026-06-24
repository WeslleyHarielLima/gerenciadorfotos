"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { IC, Ico } from "@/components/icons";
import { Event, UserRole } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  completed: "Concluído",
  cancelled: "Cancelado",
  pending_validation: "Aguardando validação",
};

const STATUS_BADGE: Record<string, string> = {
  active: "ds-badge-success",
  completed: "ds-badge-neutral",
  cancelled: "ds-badge-danger",
  pending_validation: "ds-badge-warning",
};

export default function EventsPage() {
  const router = useRouter();
  const params = useParams();
  const cityId = Number(params.cityId);
  const [events, setEvents] = useState<Event[]>([]);
  const [cityName, setCityName] = useState("");
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workByEvent, setWorkByEvent] = useState<Record<number, number>>({});

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) {
      router.replace("/");
      return;
    }
    setUserRole(user.role);
    if (!cityId || isNaN(cityId)) {
      router.replace("/dashboard");
      return;
    }
    ApiClient.getEvents(cityId)
      .then((data) => {
        setEvents(data);
        if (data.length > 0) setCityName(data[0].city_name);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // Editor/Curador/Publicador: contagem de trabalho pendente por evento (badge)
    if (["editor", "curator", "publisher"].includes(user.role)) {
      ApiClient.getWorkSummary()
        .then((s) => {
          const map: Record<number, number> = {};
          s.events.forEach((e) => { map[e.event_id] = e.count; });
          setWorkByEvent(map);
        })
        .catch(() => {});
    }
  }, [cityId, router]);

  return (
    <div className="page-pad" style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 28px 40px" }}>
      <PageHeader title={cityName ? `Eventos — ${cityName}` : "Eventos"} backHref="/dashboard/cities" />

      {loading && <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>}

      {error && <p className="ds-alert ds-alert-danger">{error}</p>}

      {!loading && !error && events.length === 0 && (
        <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhum evento ativo para esta cidade.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {events.map((event) => (
          <div key={event.id} className="ds-card ds-hover" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <p className="ds-text-primary" style={{ fontSize: 15, fontWeight: 700 }}>{event.name}</p>
                {event.location && (
                  <p className="ds-text-muted" style={{ fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.location}</p>
                )}
                {event.description && (
                  <p className="ds-text-muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{event.description}</p>
                )}
                <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                  {(userRole === "uploader" || userRole === "admin") && (
                    <Link href={`/dashboard/uploader/${cityId}/${event.id}`} className="ds-link" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                      <Ico d={IC.upload} size={14} /> Enviar fotos/vídeos
                    </Link>
                  )}
                  {(userRole === "editor" || userRole === "admin") && (
                    <Link href={`/dashboard/editor/${cityId}/${event.id}`} className="ds-link" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                      <Ico d={IC.edit} size={14} /> Editar fotos
                      {workByEvent[event.id] > 0 && (
                        <span className="ds-badge ds-badge-danger" style={{ marginLeft: 2 }}>{workByEvent[event.id]}</span>
                      )}
                    </Link>
                  )}
                  {(userRole === "curator" || userRole === "admin") && (
                    <Link href={`/dashboard/curator/${cityId}/${event.id}`} className="ds-link" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                      <Ico d={IC.review} size={14} /> Revisar fotos
                      {workByEvent[event.id] > 0 && (
                        <span className="ds-badge ds-badge-danger" style={{ marginLeft: 2 }}>{workByEvent[event.id]}</span>
                      )}
                    </Link>
                  )}
                  {(userRole === "publisher" || userRole === "admin") && (
                    <Link href={`/dashboard/publisher/${cityId}/${event.id}`} className="ds-link" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                      <Ico d={IC.publish} size={14} /> Publicar fotos
                      {workByEvent[event.id] > 0 && (
                        <span className="ds-badge ds-badge-danger" style={{ marginLeft: 2 }}>{workByEvent[event.id]}</span>
                      )}
                    </Link>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <span className={`ds-badge ${STATUS_BADGE[event.status] ?? "ds-badge-neutral"}`}>
                  {STATUS_LABELS[event.status] ?? event.status}
                </span>
                {event.event_date && (
                  <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {new Date(event.event_date + "T12:00:00").toLocaleDateString("pt-BR")}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
