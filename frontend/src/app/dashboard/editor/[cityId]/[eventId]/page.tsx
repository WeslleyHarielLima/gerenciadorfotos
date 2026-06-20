"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiClient } from "@/lib/api";
import { EditorBoard, MediaItem, TaskItem, UploadEditedResultItem } from "@/lib/types";
import PhotoDrawer from "@/components/PhotoDrawer";

const REASON_OPTIONS = [
  { value: "technical_issue", label: "Problema técnico" },
  { value: "wrong_file", label: "Arquivo errado" },
  { value: "duplicate", label: "Arquivo duplicado" },
  { value: "client_request", label: "Pedido do cliente" },
  { value: "other", label: "Outro" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Thumbnail({ url, alt }: { url?: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-300 text-lg">
        🖼
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className="w-12 h-12 rounded object-cover flex-shrink-0 bg-gray-100"
    />
  );
}

export default function EditorKanbanPage() {
  const params = useParams();
  const eventId = Number(params.eventId);
  const cityId = Number(params.cityId);

  const [board, setBoard] = useState<EditorBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Drawer
  const [drawerMediaId, setDrawerMediaId] = useState<number | null>(null);

  // Disponíveis
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  // Upload editado
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadEditedResultItem[]>([]);

  // Desistência modal
  const [abandonTarget, setAbandonTarget] = useState<TaskItem | null>(null);
  const [abandonReason, setAbandonReason] = useState("technical_issue");
  const [abandonCustom, setAbandonCustom] = useState("");
  const [abandoning, setAbandoning] = useState(false);
  const [abandonError, setAbandonError] = useState("");

  function loadBoard() {
    setLoading(true);
    ApiClient.getEditorBoard(eventId)
      .then(setBoard)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (eventId) loadBoard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!board) return;
    if (selected.size === board.available.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(board.available.map((m) => m.id)));
    }
  }

  async function handleDownload() {
    if (selected.size === 0) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const blob = await ApiClient.downloadBatch(Array.from(selected));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "edicao.zip";
      a.click();
      URL.revokeObjectURL(url);
      setSelected(new Set());
      loadBoard();
    } catch (e: unknown) {
      setDownloadError(e instanceof Error ? e.message : "Erro no download.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleUploadEdited(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (uploadRef.current) uploadRef.current.value = "";
    setUploading(true);
    setUploadResults([]);
    try {
      const data = await ApiClient.uploadEdited(Array.from(files));
      setUploadResults(data.results);
      loadBoard();
    } catch (e: unknown) {
      setUploadResults([{
        filename: "—",
        success: false,
        media_version_id: null,
        fraud_detected: false,
        unlinked: false,
        error: e instanceof Error ? e.message : "Erro no upload.",
      }]);
    } finally {
      setUploading(false);
    }
  }

  async function handleAbandon() {
    if (!abandonTarget) return;
    if (abandonReason === "other" && !abandonCustom.trim()) {
      setAbandonError("Descreva o motivo quando escolher 'Outro'.");
      return;
    }
    setAbandoning(true);
    setAbandonError("");
    try {
      await ApiClient.abandonTask(abandonTarget.task_id, abandonReason, abandonCustom);
      setAbandonTarget(null);
      setAbandonReason("technical_issue");
      setAbandonCustom("");
      loadBoard();
    } catch (e: unknown) {
      setAbandonError(e instanceof Error ? e.message : "Erro ao abandonar tarefa.");
    } finally {
      setAbandoning(false);
    }
  }

  return (
    <>
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <nav className="text-sm text-gray-500 mb-6 flex items-center gap-2">
          <Link href="/dashboard" className="hover:text-blue-600">Início</Link>
          <span className="text-gray-300">›</span>
          <Link href={`/dashboard/${cityId}`} className="hover:text-blue-600">Cidade</Link>
          <span className="text-gray-300">›</span>
          <span className="text-gray-800 font-medium">Kanban do Editor</span>
        </nav>

        {loading && <p className="text-sm text-gray-400">Carregando...</p>}
        {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>}

        {board && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── Coluna: Disponíveis ── */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">
                  Disponíveis
                  <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                    {board.available.length}
                  </span>
                </h3>
                {board.available.length > 0 && (
                  <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                    {selected.size === board.available.length ? "Desmarcar todos" : "Selecionar todos"}
                  </button>
                )}
              </div>

              {board.available.length === 0 && (
                <p className="text-sm text-gray-400">Nenhuma mídia disponível.</p>
              )}

              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {board.available.map((m: MediaItem) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50"
                  >
                    {/* Checkbox — zona independente */}
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggleSelect(m.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 flex-shrink-0 cursor-pointer"
                    />
                    {/* Thumbnail + info — abre drawer */}
                    <button
                      onClick={() => setDrawerMediaId(m.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <Thumbnail url={m.cloudinary_url} alt={m.original_filename} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.original_filename}</p>
                        <p className="text-xs text-gray-400">{m.mime_type} · {formatSize(m.file_size)}</p>
                      </div>
                    </button>
                  </div>
                ))}
              </div>

              {downloadError && (
                <p className="text-xs text-red-600 mt-3">{downloadError}</p>
              )}

              <button
                onClick={handleDownload}
                disabled={selected.size === 0 || downloading}
                className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {downloading
                  ? "Baixando..."
                  : `Baixar ${selected.size > 0 ? `(${selected.size})` : "selecionados"}`}
              </button>
            </section>

            {/* ── Coluna: Editando ── */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">
                  Editando
                  <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                    {board.editing.length}
                  </span>
                </h3>
                <button
                  onClick={() => uploadRef.current?.click()}
                  disabled={board.editing.length === 0 || uploading}
                  className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 text-white px-3 py-1 rounded-lg transition-colors"
                >
                  {uploading ? "Enviando..." : "Enviar editadas"}
                </button>
              </div>

              <input
                ref={uploadRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => handleUploadEdited(e.target.files)}
              />

              {uploadResults.length > 0 && (
                <div className="mb-3 space-y-1">
                  {uploadResults.map((r, i) => (
                    <div key={i} className={`text-xs px-3 py-1.5 rounded-lg ${r.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      <span className="font-medium">{r.filename}</span>
                      {r.success && " — enviado com sucesso"}
                      {r.fraud_detected && " — FRAUDE DETECTADA (arquivo idêntico ao original)"}
                      {r.unlinked && " — arquivo não identificado: mantenha o nome original do arquivo ao exportar"}
                      {r.error && !r.fraud_detected && !r.unlinked && ` — ${r.error}`}
                    </div>
                  ))}
                </div>
              )}

              {board.editing.length === 0 && (
                <p className="text-sm text-gray-400">Nenhum arquivo em edição.</p>
              )}

              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {board.editing.map((t: TaskItem) => (
                  <div
                    key={t.task_id}
                    className="rounded-lg border border-yellow-100 bg-yellow-50 overflow-hidden"
                  >
                    {/* Área clicável para abrir drawer */}
                    <button
                      onClick={() => setDrawerMediaId(t.media_id)}
                      className="flex items-center gap-3 w-full p-3 text-left hover:bg-yellow-100 transition-colors"
                    >
                      <Thumbnail url={t.cloudinary_url} alt={t.original_filename} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.original_filename}</p>
                        <p className="text-xs text-gray-500">{t.mime_type} · {formatSize(t.file_size)}</p>
                      </div>
                    </button>
                    {/* Ação separada */}
                    <div className="px-3 pb-2">
                      <button
                        onClick={() => {
                          setAbandonTarget(t);
                          setAbandonReason("technical_issue");
                          setAbandonCustom("");
                          setAbandonError("");
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Desistir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Coluna: Enviadas ── */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-4">
                Enviadas
                <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  {board.sent.length}
                </span>
              </h3>

              {board.sent.length === 0 && (
                <p className="text-sm text-gray-400">Nenhuma mídia enviada ainda.</p>
              )}

              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {board.sent.map((t: TaskItem) => (
                  <button
                    key={t.task_id}
                    onClick={() => setDrawerMediaId(t.media_id)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-green-100 bg-green-50 text-left hover:bg-green-100 transition-colors"
                  >
                    <Thumbnail url={t.cloudinary_url} alt={t.original_filename} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.original_filename}</p>
                      <p className="text-xs text-gray-500">{t.mime_type} · {formatSize(t.file_size)}</p>
                      <span className="text-xs text-green-700 font-medium">aguardando revisão</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── Modal de desistência ── */}
        {abandonTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h4 className="font-semibold text-gray-900 mb-1">Desistir da edição</h4>
              <p className="text-sm text-gray-500 mb-4 truncate">{abandonTarget.original_filename}</p>

              <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
              <select
                value={abandonReason}
                onChange={(e) => setAbandonReason(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {abandonReason === "other" && (
                <textarea
                  value={abandonCustom}
                  onChange={(e) => setAbandonCustom(e.target.value)}
                  placeholder="Descreva o motivo..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              )}

              {abandonError && (
                <p className="text-xs text-red-600 mb-3">{abandonError}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setAbandonTarget(null)}
                  className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAbandon}
                  disabled={abandoning}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                >
                  {abandoning ? "Abandonando..." : "Confirmar desistência"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Drawer global — fora do main para não conflitar com z-index */}
      <PhotoDrawer
        mediaId={drawerMediaId}
        onClose={() => setDrawerMediaId(null)}
      />
    </>
  );
}
