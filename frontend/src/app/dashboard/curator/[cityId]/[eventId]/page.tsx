"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiClient } from "@/lib/api";
import { ReviewItem, VersionHistoryItem } from "@/lib/types";
import { getAccessToken } from "@/lib/auth";
import { IC, Ico } from "@/components/icons";
import PhotoLightbox from "@/components/PhotoLightbox";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

function MediaViewer({ proxyUrl, alt }: { proxyUrl: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!proxyUrl) return;
    const token = getAccessToken();
    const fullUrl = proxyUrl.startsWith("http") ? proxyUrl : `${BASE}${proxyUrl.replace("/api", "")}`;

    fetch(fullUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.ok) throw new Error("Erro ao carregar imagem.");
        return res.blob();
      })
      .then((blob) => setSrc(URL.createObjectURL(blob)))
      .catch(() => setError(true));

    return () => {
      setSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [proxyUrl]);

  if (error)
    return (
      <div
        className="flex items-center justify-center h-48 rounded-lg ds-text-muted"
        style={{ fontSize: 13, background: "var(--bg-card-muted)", border: "1px solid var(--border-subtle)" }}
      >
        Não foi possível carregar a imagem.
      </div>
    );
  if (!src)
    return (
      <div
        className="flex items-center justify-center h-48 rounded-lg ds-text-muted animate-pulse"
        style={{ fontSize: 13, background: "var(--bg-card-muted)", border: "1px solid var(--border-subtle)" }}
      >
        Carregando...
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="w-full rounded-lg object-contain max-h-80"
      style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)" }}
    />
  );
}

function VersionHistory({ history }: { history: VersionHistoryItem[] }) {
  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <h5 className="ds-eyebrow mb-2">Histórico de versões</h5>
      <div className="space-y-1.5">
        {history.map((v) => (
          <div key={v.version} className="flex items-center gap-3 ds-text-secondary" style={{ fontSize: 12 }}>
            <span
              className="px-2 py-0.5 rounded font-mono ds-text-secondary"
              style={{ background: "var(--bg-card-muted)" }}
            >
              v{v.version}
            </span>
            <span
              className={`ds-badge ${
                v.status === "approved"
                  ? "ds-badge-success"
                  : v.status === "rejected"
                  ? "ds-badge-danger"
                  : v.status === "edited"
                  ? "ds-badge-warning"
                  : "ds-badge-neutral"
              }`}
            >
              {v.status}
            </span>
            <span>{v.edited_by ?? "uploader"}</span>
            <span className="ds-text-muted">{formatDate(v.edited_at)}</span>
            <span className="ds-text-muted">{formatSize(v.file_size)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type ModalMode = "approve" | "reject-return" | "reject-final";

interface ReviewModal {
  item: ReviewItem;
  mode: ModalMode | null;
  feedback: string;
  loading: boolean;
  error: string;
  confirmFinal: boolean;
}

export default function CuratorKanbanPage() {
  const params = useParams();
  const eventId = Number(params.eventId);
  const cityId = Number(params.cityId);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const [modal, setModal] = useState<ReviewModal | null>(null);

  // Lightbox de comparação em tela cheia (0 = original, 1 = editada)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const loadQueue = useCallback(() => {
    setPageLoading(true);
    ApiClient.getReviewQueue()
      .then((data) => setItems(data.items))
      .catch((e: Error) => setPageError(e.message))
      .finally(() => setPageLoading(false));
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  function openModal(item: ReviewItem) {
    setModal({ item, mode: null, feedback: "", loading: false, error: "", confirmFinal: false });
  }

  function closeModal() {
    setModal(null);
  }

  async function handleDecision() {
    if (!modal) return;
    const { item, mode, feedback } = modal;

    if ((mode === "reject-return" || mode === "reject-final") && !feedback.trim()) {
      setModal((m) => m && { ...m, error: "Justificativa obrigatória." });
      return;
    }

    if (mode === "reject-final" && !modal.confirmFinal) {
      setModal((m) => m && { ...m, confirmFinal: true });
      return;
    }

    setModal((m) => m && { ...m, loading: true, error: "" });

    try {
      if (mode === "approve") {
        await ApiClient.approveTask(item.task_id);
      } else if (mode === "reject-return") {
        await ApiClient.rejectWithReturn(item.task_id, feedback.trim());
      } else if (mode === "reject-final") {
        await ApiClient.rejectFinal(item.task_id, feedback.trim());
      }
      closeModal();
      loadQueue();
    } catch (e: unknown) {
      setModal((m) =>
        m && { ...m, loading: false, error: e instanceof Error ? e.message : "Erro ao processar decisão." }
      );
    }
  }

  const decisionLabel: Record<ModalMode, string> = {
    approve: "Aprovar",
    "reject-return": "Rejeitar com retorno",
    "reject-final": "Rejeição definitiva",
  };

  const decisionColor: Record<ModalMode, string> = {
    approve: "ds-btn-brand",
    "reject-return": "ds-btn-primary",
    "reject-final": "ds-btn-danger",
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 40px" }}>
      {/* Breadcrumb */}
      <nav className="ds-breadcrumb" style={{ marginBottom: 20 }}>
        <Link href="/dashboard">Início</Link>
        <span className="sep">›</span>
        <Link href={`/dashboard/${cityId}`}>Cidade</Link>
        <span className="sep">›</span>
        <span className="current">Revisão do Curador</span>
      </nav>

      <div className="flex items-center justify-between" style={{ marginBottom: 22 }}>
        <h2 className="ds-title" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          Aguardando revisão
          {items.length > 0 && (
            <span className="ds-badge ds-badge-warning">{items.length}</span>
          )}
        </h2>
        <button
          onClick={loadQueue}
          className="ds-btn ds-btn-ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px" }}
        >
          <Ico d={IC.review} size={14} /> Atualizar
        </button>
      </div>

      {pageLoading && <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>}
      {pageError && <p className="ds-alert ds-alert-danger">{pageError}</p>}

      {!pageLoading && items.length === 0 && !pageError && (
        <div className="text-center py-16 ds-text-muted">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <Ico d={IC.check} size={40} />
          </div>
          <p style={{ fontSize: 13 }}>Nenhuma mídia aguardando revisão.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <button
            key={item.task_id}
            onClick={() => openModal(item)}
            className="text-left ds-card ds-hover overflow-hidden group"
            style={{ padding: 0 }}
          >
            {/* Thumbnail do card */}
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
                <Ico d={IC.image} size={40} />
              </div>
            )}
            <div className="p-4">
              <p className="ds-text-primary truncate" style={{ fontSize: 14, fontWeight: 600 }}>
                {item.original_filename}
              </p>
              <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 4 }}>{item.mime_type}</p>
              <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                {item.version_history.length} versão(ões) · clique para revisar
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Modal de revisão ── */}
      {modal && (
        <div
          className="fixed inset-0 flex items-start justify-center z-50 p-4 overflow-y-auto"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="ds-card-emphasis rounded-2xl w-full max-w-4xl my-8"
            style={{ padding: 0, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <h3 className="ds-text-primary truncate flex-1 mr-4" style={{ fontWeight: 600 }}>
                {modal.item.original_filename}
              </h3>
              <button
                onClick={closeModal}
                className="ds-text-muted ds-hover flex items-center justify-center rounded"
                style={{ width: 32, height: 32 }}
                aria-label="Fechar"
              >
                <Ico d={IC.close} size={18} />
              </button>
            </div>

            {/* Comparação lado a lado */}
            <div
              className="grid grid-cols-2 gap-4 p-6"
              style={{ background: "var(--bg-card-muted)" }}
            >
              <div>
                <p className="ds-eyebrow mb-2">Original</p>
                {modal.item.cloudinary_url ? (
                  <img
                    src={modal.item.cloudinary_url}
                    alt="Versão original"
                    onClick={() => setLightboxIndex(0)}
                    title="Ampliar"
                    className="w-full rounded-lg object-contain max-h-80"
                    style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", cursor: "zoom-in" }}
                  />
                ) : (
                  <MediaViewer
                    proxyUrl={modal.item.original_proxy_url}
                    alt="Versão original"
                  />
                )}
              </div>
              <div>
                <p className="ds-eyebrow mb-2">Editada</p>
                {modal.item.edited_cloudinary_url ? (
                  <img
                    src={modal.item.edited_cloudinary_url}
                    alt="Versão editada"
                    onClick={() => setLightboxIndex(1)}
                    title="Ampliar"
                    className="w-full rounded-lg object-contain max-h-80"
                    style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", cursor: "zoom-in" }}
                  />
                ) : (
                  <MediaViewer
                    proxyUrl={modal.item.edited_proxy_url}
                    alt="Versão editada"
                  />
                )}
              </div>
            </div>

            {/* Histórico de versões */}
            <div className="px-6">
              <VersionHistory history={modal.item.version_history} />
            </div>

            {/* Área de decisão */}
            <div className="px-6 py-5">
              {!modal.mode && (
                <>
                  <p className="ds-text-secondary mb-4" style={{ fontSize: 14, fontWeight: 500 }}>Selecione uma decisão:</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: "approve" })}
                      className="ds-btn ds-btn-brand"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px" }}
                    >
                      <Ico d={IC.check} size={15} /> Aprovar
                    </button>
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: "reject-return" })}
                      className="ds-btn ds-btn-primary"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px" }}
                    >
                      <Ico d={IC.arrow} size={15} /> Rejeitar com retorno
                    </button>
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: "reject-final" })}
                      className="ds-btn ds-btn-danger"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px" }}
                    >
                      <Ico d={IC.close} size={15} /> Rejeição definitiva
                    </button>
                  </div>
                </>
              )}

              {modal.mode && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: null, feedback: "", error: "", confirmFinal: false })}
                      className="ds-link"
                      style={{ fontSize: 12 }}
                    >
                      ← Voltar
                    </button>
                    <span className="ds-text-primary" style={{ fontSize: 14, fontWeight: 600 }}>
                      {decisionLabel[modal.mode]}
                    </span>
                  </div>

                  {modal.mode !== "approve" && (
                    <textarea
                      value={modal.feedback}
                      onChange={(e) => setModal((m) => m && { ...m, feedback: e.target.value })}
                      placeholder="Justificativa obrigatória..."
                      rows={3}
                      className="ds-text-input w-full mb-3 resize-none"
                    />
                  )}

                  {modal.mode === "approve" && (
                    <p className="ds-text-muted mb-3" style={{ fontSize: 14 }}>
                      A versão editada será aprovada e uma tarefa será criada para o publicador.
                      Versões intermediárias serão agendadas para exclusão.
                    </p>
                  )}

                  {modal.confirmFinal && modal.mode === "reject-final" && (
                    <div className="ds-alert ds-alert-danger mb-3">
                      Esta ação é irreversível. A mídia será marcada como rejeitada definitivamente
                      e todas as versões editadas serão excluídas.
                    </div>
                  )}

                  {modal.error && (
                    <p className="mb-3" style={{ fontSize: 12, color: "var(--state-danger)" }}>{modal.error}</p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={closeModal}
                      className="flex-1 ds-btn ds-btn-ghost"
                      style={{ padding: "9px 16px" }}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleDecision}
                      disabled={
                        modal.loading ||
                        (modal.mode !== "approve" && !modal.feedback.trim())
                      }
                      className={`flex-1 ds-btn ${modal.mode ? decisionColor[modal.mode] : ""}`}
                      style={{ padding: "9px 16px" }}
                    >
                      {modal.loading
                        ? "Processando..."
                        : modal.confirmFinal && modal.mode === "reject-final"
                        ? "Confirmar rejeição definitiva"
                        : decisionLabel[modal.mode]}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox de comparação em tela cheia (alterna original ↔ editada com ← →) */}
      <PhotoLightbox
        items={modal ? [
          { id: 0, url: modal.item.cloudinary_url, filename: `Original — ${modal.item.original_filename}` },
          { id: 1, url: modal.item.edited_cloudinary_url, filename: `Editada — ${modal.item.original_filename}` },
        ] : []}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}
