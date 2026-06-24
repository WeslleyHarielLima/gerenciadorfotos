"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { ApiClient } from "@/lib/api";
import { ReviewItem, VersionHistoryItem } from "@/lib/types";
import { getAccessToken } from "@/lib/auth";
import { IC, Ico } from "@/components/icons";
import PhotoLightbox from "@/components/PhotoLightbox";
import { downloadProxyFile } from "@/lib/download";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

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

  // Confirmação da última decisão (sinalização para o curador)
  const [flash, setFlash] = useState("");

  // Lightbox de comparação em tela cheia (0 = original, 1 = editada)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Qual versão está sendo baixada ("" = nenhuma)
  const [downloading, setDownloading] = useState<"" | "original" | "edited">("");

  const loadQueue = useCallback((silent = false) => {
    if (!silent) setPageLoading(true);
    ApiClient.getReviewQueue(eventId)
      .then((data) => setItems(data.items))
      .catch((e: Error) => setPageError(e.message))
      .finally(() => { if (!silent) setPageLoading(false); });
  }, [eventId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Atualiza a fila automaticamente (silencioso; pausa com modal de revisão aberto)
  useAutoRefresh(() => loadQueue(true), { enabled: !modal });

  // Some com a confirmação após alguns segundos
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(""), 5000);
    return () => clearTimeout(id);
  }, [flash]);

  function openModal(item: ReviewItem) {
    setModal({ item, mode: null, feedback: "", loading: false, error: "", confirmFinal: false });
  }

  function closeModal() {
    setModal(null);
  }

  async function handleDownload(which: "original" | "edited") {
    if (!modal || downloading) return;
    setDownloading(which);
    try {
      const url = which === "original" ? modal.item.original_proxy_url : modal.item.edited_proxy_url;
      const name = which === "original" ? modal.item.original_filename : `editada-${modal.item.original_filename}`;
      await downloadProxyFile(url, name);
    } catch {
      alert("Falha ao baixar o arquivo. Tente novamente.");
    } finally {
      setDownloading("");
    }
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
      let message = "";
      if (mode === "approve") {
        await ApiClient.approveTask(item.task_id);
        message = `“${item.original_filename}” aprovada e enviada ao publicador.`;
      } else if (mode === "reject-return") {
        await ApiClient.rejectWithReturn(item.task_id, feedback.trim());
        message = `“${item.original_filename}” devolvida ao editor para correção.`;
      } else if (mode === "reject-final") {
        await ApiClient.rejectFinal(item.task_id, feedback.trim());
        message = `“${item.original_filename}” rejeitada definitivamente.`;
      }
      closeModal();
      setFlash(message);
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
    <div className="page-pad" style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 40px" }}>
      {/* Breadcrumb */}
      <PageHeader title="Revisar fotos" backHref={`/dashboard/${cityId}`} />

      <div className="flex items-center justify-between" style={{ marginBottom: 22 }}>
        <h2 className="ds-title" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          Aguardando revisão
          {items.length > 0 && (
            <span className="ds-badge ds-badge-warning">{items.length}</span>
          )}
        </h2>
        <button
          onClick={() => loadQueue()}
          className="ds-btn ds-btn-ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px" }}
        >
          <Ico d={IC.review} size={14} /> Atualizar
        </button>
      </div>

      {flash && (
        <p className="ds-alert ds-alert-success" style={{ marginBottom: 16 }}>{flash}</p>
      )}

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
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-6"
              style={{ background: "var(--bg-card-muted)" }}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="ds-eyebrow">Original</p>
                  {modal.item.original_proxy_url && (
                    <button
                      onClick={() => handleDownload("original")}
                      disabled={downloading !== ""}
                      className="ds-link inline-flex items-center"
                      style={{ fontSize: 12, gap: 4, background: "none", border: "none", cursor: "pointer" }}
                    >
                      <Ico d={IC.download} size={13} />
                      {downloading === "original" ? "Baixando…" : "Baixar"}
                    </button>
                  )}
                </div>
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
                <div className="flex items-center justify-between mb-2">
                  <p className="ds-eyebrow">Editada</p>
                  {modal.item.edited_proxy_url && (
                    <button
                      onClick={() => handleDownload("edited")}
                      disabled={downloading !== ""}
                      className="ds-link inline-flex items-center"
                      style={{ fontSize: 12, gap: 4, background: "none", border: "none", cursor: "pointer" }}
                    >
                      <Ico d={IC.download} size={13} />
                      {downloading === "edited" ? "Baixando…" : "Baixar"}
                    </button>
                  )}
                </div>
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
