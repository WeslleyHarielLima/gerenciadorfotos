"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiClient } from "@/lib/api";
import { PublishHistoryGroup, PublishItem } from "@/lib/types";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

function formatDateLabel(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface ConfirmState {
  item: PublishItem;
  loading: boolean;
  error: string;
}

export default function PublisherKanbanPage() {
  const params = useParams();
  const cityId = Number(params.cityId);
  const eventId = Number(params.eventId);

  const [tab, setTab] = useState<"queue" | "history">("queue");

  const [queue, setQueue] = useState<PublishItem[]>([]);
  const [historyGroups, setHistoryGroups] = useState<PublishHistoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const loadQueue = useCallback(() => {
    setLoading(true);
    setPageError("");
    ApiClient.getPublishQueue()
      .then((data) => setQueue(data.items))
      .catch((e: Error) => setPageError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadHistory = useCallback(() => {
    setLoading(true);
    setPageError("");
    ApiClient.getPublishHistory()
      .then((data) => setHistoryGroups(data.groups))
      .catch((e: Error) => setPageError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "queue") loadQueue();
    else loadHistory();
  }, [tab, loadQueue, loadHistory]);

  async function handlePublish() {
    if (!confirm) return;
    setConfirm((c) => c && { ...c, loading: true, error: "" });

    try {
      await ApiClient.publishTask(confirm.item.task_id);
      setConfirm(null);
      loadQueue();
    } catch (e: unknown) {
      setConfirm((c) =>
        c && { ...c, loading: false, error: e instanceof Error ? e.message : "Erro ao publicar." }
      );
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-6 flex items-center gap-2">
        <Link href="/dashboard" className="hover:text-blue-600">Início</Link>
        <span className="text-gray-300">›</span>
        <Link href={`/dashboard/${cityId}`} className="hover:text-blue-600">Cidade</Link>
        <span className="text-gray-300">›</span>
        <span className="text-gray-800 font-medium">Publicador</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Publicação</h1>
        <button
          onClick={() => (tab === "queue" ? loadQueue() : loadHistory())}
          className="text-sm text-blue-600 hover:underline"
        >
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        <button
          onClick={() => setTab("queue")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "queue"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Para publicar
          {queue.length > 0 && tab !== "queue" && (
            <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
              {queue.length}
            </span>
          )}
          {tab === "queue" && queue.length > 0 && (
            <span className="ml-2 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full">
              {queue.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "history"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Histórico
        </button>
      </div>

      {loading && <p className="text-sm text-gray-400">Carregando...</p>}
      {pageError && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{pageError}</p>
      )}

      {/* ── Aba: Para publicar ── */}
      {tab === "queue" && !loading && (
        <>
          {queue.length === 0 && !pageError && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">✓</p>
              <p className="text-sm">Nenhuma mídia aguardando publicação.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {queue.map((item) => (
              <div
                key={item.task_id}
                className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {item.original_filename}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{item.mime_type}</p>
                </div>
                <div className="text-xs text-gray-400 space-y-0.5">
                  <p>{item.event_name}</p>
                  <p>{item.city_name}</p>
                </div>
                <button
                  onClick={() => setConfirm({ item, loading: false, error: "" })}
                  className="mt-auto w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                >
                  Publicar
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Aba: Histórico ── */}
      {tab === "history" && !loading && (
        <>
          {historyGroups.length === 0 && !pageError && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-sm">Nenhuma publicação registrada ainda.</p>
            </div>
          )}

          <div className="space-y-8">
            {historyGroups.map((group) => (
              <section key={group.date}>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 capitalize">
                  {formatDateLabel(group.date)}
                  <span className="ml-2 text-gray-400 font-normal normal-case">
                    · {group.items.length} publicação(ões)
                  </span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.items.map((item) => (
                    <div
                      key={item.task_id}
                      className="bg-white rounded-xl border border-gray-100 p-4"
                    >
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {item.original_filename}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{item.mime_type}</p>
                      <p className="text-xs text-gray-500 mt-2">{item.event_name}</p>
                      <p className="text-xs text-gray-400">{item.city_name}</p>
                      <p className="text-xs text-gray-400 mt-2">
                        Publicado em {formatDate(item.published_at)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {/* ── Modal de confirmação de publicação ── */}
      {confirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 mb-2">Confirmar publicação</h3>
            <p className="text-sm text-gray-600 mb-1 truncate">
              <span className="font-medium">{confirm.item.original_filename}</span>
            </p>
            <p className="text-xs text-gray-400 mb-4">
              {confirm.item.event_name} · {confirm.item.city_name}
            </p>
            <p className="text-sm text-gray-600 mb-5">
              O arquivo será movido para a pasta de publicados no Drive e marcado como publicado.
              Esta ação não pode ser desfeita.
            </p>

            {confirm.error && (
              <p className="text-xs text-red-600 mb-3">{confirm.error}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setConfirm(null)}
                disabled={confirm.loading}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handlePublish}
                disabled={confirm.loading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:bg-gray-200 disabled:text-gray-400"
              >
                {confirm.loading ? "Publicando..." : "Confirmar publicação"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
