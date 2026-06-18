"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { Event } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  completed: "Concluído",
  cancelled: "Cancelado",
  pending_validation: "Aguardando validação",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-600",
  pending_validation: "bg-yellow-100 text-yellow-700",
};

export default function EventsPage() {
  const router = useRouter();
  const params = useParams();
  const cityId = Number(params.cityId);
  const [events, setEvents] = useState<Event[]>([]);
  const [cityName, setCityName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) {
      router.replace("/");
      return;
    }
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
  }, [cityId, router]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <nav className="text-sm text-gray-500 mb-6 flex items-center gap-2">
        <Link href="/dashboard" className="hover:text-blue-600 transition-colors">
          Início
        </Link>
        <span className="text-gray-300">›</span>
        <span className="text-gray-800 font-medium">{cityName || "Cidade"}</span>
      </nav>

      <h2 className="text-xl font-semibold text-gray-800 mb-6">
        Eventos {cityName ? `— ${cityName}` : ""}
      </h2>

      {loading && <p className="text-sm text-gray-400">Carregando...</p>}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>
      )}

      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-gray-400">Nenhum evento ativo para esta cidade.</p>
      )}

      <div className="space-y-3">
        {events.map((event) => (
          <div
            key={event.id}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{event.name}</p>
                {event.location && (
                  <p className="text-sm text-gray-500 mt-0.5 truncate">{event.location}</p>
                )}
                {event.description && (
                  <p className="text-sm text-gray-400 mt-1 line-clamp-2">{event.description}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[event.status] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {STATUS_LABELS[event.status] ?? event.status}
                </span>
                {event.event_date && (
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(event.event_date + "T12:00:00").toLocaleDateString("pt-BR")}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
