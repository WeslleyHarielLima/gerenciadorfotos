"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
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
  const [userRole, setUserRole] = useState("");

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) {
      router.replace("/");
      return;
    }
    setUserRole(user.role);

    if (user.role === "admin") {
      router.replace("/dashboard/admin");
      return;
    }

    Promise.all([
      ApiClient.getCities(),
      ApiClient.getActiveTasks(),
    ])
      .then(([c, t]) => {
        setCities(c);
        setActiveTasks(t);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      {/* Em andamento */}
      <section className="mb-10">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Em andamento
        </h3>
        {loading && <p className="text-sm text-gray-400">Carregando...</p>}
        {!loading && activeTasks.length === 0 && (
          <p className="text-sm text-gray-400">Nenhuma tarefa em andamento.</p>
        )}
        {!loading && activeTasks.length > 0 && (
          <div className="flex flex-col gap-2">
            {activeTasks.map((task) => (
              <Link
                key={task.task_id}
                href={activeTaskLink(task)}
                className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 hover:bg-blue-100 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{task.filename}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {task.event_name} · {task.city_name}
                  </p>
                </div>
                <span className="ml-4 shrink-0 text-xs font-semibold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">
                  {ROLE_LABELS[task.role_type] ?? task.role_type}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Cidades */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
          Cidades com trabalho
        </h3>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>
        )}

        {!loading && !error && cities.length === 0 && (
          <p className="text-sm text-gray-400">Nenhuma cidade com eventos ativos no momento.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cities.map((city) => (
            <Link
              key={city.id}
              href={`/dashboard/${city.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-blue-300 transition-all"
            >
              <p className="font-semibold text-gray-900">{city.name}</p>
              <p className="text-sm text-gray-500 mt-0.5">{city.state}</p>
              <p className="text-xs text-blue-600 mt-3 font-medium">
                {city.active_event_count}{" "}
                evento{city.active_event_count !== 1 ? "s" : ""} ativo
                {city.active_event_count !== 1 ? "s" : ""}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
