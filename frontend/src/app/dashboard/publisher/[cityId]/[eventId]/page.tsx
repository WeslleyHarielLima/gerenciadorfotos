"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiClient } from "@/lib/api";
import { IC, Ico } from "@/components/icons";
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
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 28px 40px" }}>
      {/* Breadcrumb */}
      <nav className="ds-breadcrumb" style={{ marginBottom: 20 }}>
        <Link href="/dashboard">Início</Link>
        <span className="sep">›</span>
        <Link href={`/dashboard/${cityId}`}>Cidade</Link>
        <span className="sep">›</span>
        <span className="current">Publicador</span>
      </nav>

      <div className="flex items-center justify-between" style={{ marginBottom: 22 }}>
        <h2 className="ds-title">Publicação</h2>
        <button
          onClick={() => (tab === "queue" ? loadQueue() : loadHistory())}
          className="ds-link"
          style={{ fontSize: 13, background: "none", border: "none", cursor: "pointer" }}
        >
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: "1px solid var(--border-default)", marginBottom: 24 }}>
        <button
          onClick={() => setTab("queue")}
          className="flex items-center"
          style={{
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            background: "none",
            border: "none",
            cursor: "pointer",
            borderBottom: "2px solid",
            borderBottomColor: tab === "queue" ? "var(--brand-primary)" : "transparent",
            color: tab === "queue" ? "var(--brand-primary)" : "var(--text-muted)",
            transition: "var(--tr)",
          }}
        >
          Para publicar
          {queue.length > 0 && tab !== "queue" && (
            <span className="ds-badge ds-badge-info" style={{ marginLeft: 8 }}>
              {queue.length}
            </span>
          )}
          {tab === "queue" && queue.length > 0 && (
            <span className="ds-badge ds-badge-brand" style={{ marginLeft: 8 }}>
              {queue.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("history")}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            background: "none",
            border: "none",
            cursor: "pointer",
            borderBottom: "2px solid",
            borderBottomColor: tab === "history" ? "var(--brand-primary)" : "transparent",
            color: tab === "history" ? "var(--brand-primary)" : "var(--text-muted)",
            transition: "var(--tr)",
          }}
        >
          Histórico
        </button>
      </div>

      {loading && <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>}
      {pageError && <p className="ds-alert ds-alert-danger">{pageError}</p>}

      {/* ── Aba: Para publicar ── */}
      {tab === "queue" && !loading && (
        <>
          {queue.length === 0 && !pageError && (
            <div className="flex flex-col items-center" style={{ padding: "64px 0", gap: 12 }}>
              <span className="ds-text-muted"><Ico d={IC.check} size={40} /></span>
              <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhuma mídia aguardando publicação.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {queue.map((item) => (
              <div
                key={item.task_id}
                className="ds-card overflow-hidden flex flex-col"
                style={{ padding: 0 }}
              >
                {/* Thumbnail */}
                {item.cloudinary_url ? (
                  <img
                    src={item.cloudinary_url}
                    alt={item.original_filename}
                    className="w-full h-36 object-cover"
                    style={{ background: "var(--bg-card-muted)" }}
                  />
                ) : (
                  <div
                    className="w-full h-36 flex items-center justify-center ds-text-muted"
                    style={{ background: "var(--bg-card-muted)" }}
                  >
                    <Ico d={IC.image} size={32} />
                  </div>
                )}
                <div className="p-4 flex flex-col gap-2 flex-1">
                  <div>
                    <p className="ds-text-primary truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                      {item.original_filename}
                    </p>
                    <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 2 }}>{item.mime_type}</p>
                  </div>
                  <div className="ds-text-muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                    <p>{item.event_name}</p>
                    <p>{item.city_name}</p>
                  </div>
                  <button
                    onClick={() => setConfirm({ item, loading: false, error: "" })}
                    className="ds-btn ds-btn-primary mt-auto w-full flex items-center justify-center"
                    style={{ padding: "8px 12px", gap: 6 }}
                  >
                    <Ico d={IC.publish} size={15} /> Publicar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Aba: Histórico ── */}
      {tab === "history" && !loading && (
        <>
          {historyGroups.length === 0 && !pageError && (
            <div className="flex flex-col items-center" style={{ padding: "64px 0", gap: 12 }}>
              <span className="ds-text-muted"><Ico d={IC.calendar} size={40} /></span>
              <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhuma publicação registrada ainda.</p>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {historyGroups.map((group) => (
              <section key={group.date}>
                <h2 className="ds-eyebrow capitalize" style={{ marginBottom: 12 }}>
                  {formatDateLabel(group.date)}
                  <span className="ds-text-muted" style={{ marginLeft: 8, fontWeight: 400, textTransform: "none" }}>
                    · {group.items.length} publicação(ões)
                  </span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.items.map((item) => (
                    <div key={item.task_id} className="ds-card-muted" style={{ padding: 16 }}>
                      <p className="ds-text-primary truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                        {item.original_filename}
                      </p>
                      <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 2 }}>{item.mime_type}</p>
                      <p className="ds-text-secondary" style={{ fontSize: 12, marginTop: 8 }}>{item.event_name}</p>
                      <p className="ds-text-muted" style={{ fontSize: 12 }}>{item.city_name}</p>
                      <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 8 }}>
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
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="ds-card-emphasis w-full max-w-md overflow-hidden" style={{ padding: 0 }}>
            {/* Preview da foto no topo do modal */}
            {confirm.item.cloudinary_url ? (
              <img
                src={confirm.item.cloudinary_url}
                alt={confirm.item.original_filename}
                className="w-full h-48 object-cover"
                style={{ background: "var(--bg-card-muted)" }}
              />
            ) : (
              <div
                className="w-full h-32 flex items-center justify-center ds-text-muted"
                style={{ background: "var(--bg-card-muted)" }}
              >
                <Ico d={IC.image} size={32} />
              </div>
            )}

            <div className="p-6">
              <h3 className="ds-subtitle" style={{ marginBottom: 4 }}>Confirmar publicação</h3>
              <p className="ds-text-primary truncate" style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                {confirm.item.original_filename}
              </p>
              <p className="ds-text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
                {confirm.item.event_name} · {confirm.item.city_name}
              </p>
              <p className="ds-text-secondary" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
                O arquivo será movido para a pasta de publicados no Drive e marcado como publicado.
                Esta ação não pode ser desfeita.
              </p>

              {confirm.error && (
                <p className="ds-alert ds-alert-danger" style={{ marginBottom: 12 }}>{confirm.error}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setConfirm(null)}
                  disabled={confirm.loading}
                  className="ds-btn ds-btn-ghost flex-1"
                  style={{ padding: "8px 12px" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handlePublish}
                  disabled={confirm.loading}
                  className="ds-btn ds-btn-primary flex-1 flex items-center justify-center"
                  style={{ padding: "8px 12px", gap: 6 }}
                >
                  {confirm.loading ? "Publicando..." : (
                    <>
                      <Ico d={IC.publish} size={15} /> Confirmar publicação
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
