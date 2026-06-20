"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiClient } from "@/lib/api";
import { ReviewItem, VersionHistoryItem } from "@/lib/types";
import { getAccessToken } from "@/lib/auth";

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
      <div className="flex items-center justify-center h-48 bg-gray-100 rounded-lg text-sm text-gray-400">
        Não foi possível carregar a imagem.
      </div>
    );
  if (!src)
    return (
      <div className="flex items-center justify-center h-48 bg-gray-100 rounded-lg text-sm text-gray-400 animate-pulse">
        Carregando...
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="w-full rounded-lg object-contain max-h-80 bg-gray-50" />
  );
}

function VersionHistory({ history }: { history: VersionHistoryItem[] }) {
  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Histórico de versões
      </h5>
      <div className="space-y-1.5">
        {history.map((v) => (
          <div key={v.version} className="flex items-center gap-3 text-xs text-gray-600">
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
              v{v.version}
            </span>
            <span
              className={`px-2 py-0.5 rounded font-medium ${
                v.status === "approved"
                  ? "bg-green-100 text-green-700"
                  : v.status === "rejected"
                  ? "bg-red-100 text-red-600"
                  : v.status === "edited"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {v.status}
            </span>
            <span>{v.edited_by ?? "uploader"}</span>
            <span className="text-gray-400">{formatDate(v.edited_at)}</span>
            <span className="text-gray-400">{formatSize(v.file_size)}</span>
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
    approve: "bg-green-600 hover:bg-green-700",
    "reject-return": "bg-yellow-500 hover:bg-yellow-600",
    "reject-final": "bg-red-600 hover:bg-red-700",
  };

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-6 flex items-center gap-2">
        <Link href="/dashboard" className="hover:text-blue-600">Início</Link>
        <span className="text-gray-300">›</span>
        <Link href={`/dashboard/${cityId}`} className="hover:text-blue-600">Cidade</Link>
        <span className="text-gray-300">›</span>
        <span className="text-gray-800 font-medium">Revisão do Curador</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          Aguardando revisão
          {items.length > 0 && (
            <span className="ml-2 text-sm font-normal bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          )}
        </h1>
        <button
          onClick={loadQueue}
          className="text-sm text-blue-600 hover:underline"
        >
          Atualizar
        </button>
      </div>

      {pageLoading && <p className="text-sm text-gray-400">Carregando...</p>}
      {pageError && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{pageError}</p>
      )}

      {!pageLoading && items.length === 0 && !pageError && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">✓</p>
          <p className="text-sm">Nenhuma mídia aguardando revisão.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <button
            key={item.task_id}
            onClick={() => openModal(item)}
            className="text-left bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-blue-400 hover:shadow-sm transition-all group"
          >
            {/* Thumbnail do card */}
            {item.cloudinary_url ? (
              <img
                src={item.cloudinary_url}
                alt={item.original_filename}
                className="w-full h-36 object-cover bg-gray-100"
              />
            ) : (
              <div className="w-full h-36 bg-gray-100 flex items-center justify-center text-gray-300 text-4xl">
                🖼
              </div>
            )}
            <div className="p-4">
              <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-blue-700">
                {item.original_filename}
              </p>
              <p className="text-xs text-gray-500 mt-1">{item.mime_type}</p>
              <p className="text-xs text-gray-400 mt-2">
                {item.version_history.length} versão(ões) · clique para revisar
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Modal de revisão ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-8">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 truncate flex-1 mr-4">
                {modal.item.original_filename}
              </h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Comparação lado a lado */}
            <div className="grid grid-cols-2 gap-4 p-6 bg-gray-50">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Original
                </p>
                {modal.item.cloudinary_url ? (
                  <img
                    src={modal.item.cloudinary_url}
                    alt="Versão original"
                    className="w-full rounded-lg object-contain max-h-80 bg-gray-50"
                  />
                ) : (
                  <MediaViewer
                    proxyUrl={modal.item.original_proxy_url}
                    alt="Versão original"
                  />
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Editada
                </p>
                {modal.item.edited_cloudinary_url ? (
                  <img
                    src={modal.item.edited_cloudinary_url}
                    alt="Versão editada"
                    className="w-full rounded-lg object-contain max-h-80 bg-gray-50"
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
                  <p className="text-sm text-gray-600 mb-4 font-medium">Selecione uma decisão:</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: "approve" })}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Aprovar
                    </button>
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: "reject-return" })}
                      className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Rejeitar com retorno
                    </button>
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: "reject-final" })}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Rejeição definitiva
                    </button>
                  </div>
                </>
              )}

              {modal.mode && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      onClick={() => setModal((m) => m && { ...m, mode: null, feedback: "", error: "", confirmFinal: false })}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      ← Voltar
                    </button>
                    <span className="text-sm font-semibold text-gray-800">
                      {decisionLabel[modal.mode]}
                    </span>
                  </div>

                  {modal.mode !== "approve" && (
                    <textarea
                      value={modal.feedback}
                      onChange={(e) => setModal((m) => m && { ...m, feedback: e.target.value })}
                      placeholder="Justificativa obrigatória..."
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  )}

                  {modal.mode === "approve" && (
                    <p className="text-sm text-gray-500 mb-3">
                      A versão editada será aprovada e uma tarefa será criada para o publicador.
                      Versões intermediárias serão agendadas para exclusão.
                    </p>
                  )}

                  {modal.confirmFinal && modal.mode === "reject-final" && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3">
                      <p className="text-sm text-red-700 font-medium">
                        Esta ação é irreversível. A mídia será marcada como rejeitada definitivamente
                        e todas as versões editadas serão excluídas.
                      </p>
                    </div>
                  )}

                  {modal.error && (
                    <p className="text-xs text-red-600 mb-3">{modal.error}</p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={closeModal}
                      className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleDecision}
                      disabled={
                        modal.loading ||
                        (modal.mode !== "approve" && !modal.feedback.trim())
                      }
                      className={`flex-1 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:bg-gray-200 disabled:text-gray-400 ${
                        modal.mode ? decisionColor[modal.mode] : ""
                      }`}
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
    </main>
  );
}
