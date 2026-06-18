"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { City } from "@/lib/types";

export default function CitiesPage() {
  const router = useRouter();
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) {
      router.replace("/");
      return;
    }
    ApiClient.getCities()
      .then(setCities)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <section className="mb-10">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Em andamento
        </h3>
        <p className="text-sm text-gray-400">Nenhuma tarefa em andamento.</p>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
          Cidades com trabalho
        </h3>

        {loading && (
          <p className="text-sm text-gray-400">Carregando...</p>
        )}

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
