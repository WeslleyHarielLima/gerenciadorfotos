"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiClient } from "@/lib/api";
import { EditorBoard, MediaItem, TaskItem, UploadEditedResultItem } from "@/lib/types";
import PhotoDrawer from "@/components/PhotoDrawer";
import PhotoLightbox from "@/components/PhotoLightbox";
import { IC, Ico } from "@/components/icons";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

// Badge da coluna "Enviadas" conforme o status real da mídia.
const SENT_BADGE: Record<string, { label: string; cls: string }> = {
  pending_review: { label: "aguardando revisão", cls: "ds-badge-success" },
  approved: { label: "aprovada", cls: "ds-badge-success" },
  published: { label: "publicada", cls: "ds-badge-neutral" },
};

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
      <div
        className="w-12 h-12 rounded flex items-center justify-center flex-shrink-0"
        style={{ background: "var(--bg-card-muted)", color: "var(--text-muted)" }}
      >
        <Ico d={IC.image} size={18} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className="w-12 h-12 rounded object-cover flex-shrink-0"
      style={{ background: "var(--bg-card-muted)" }}
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

  // Lightbox de preview/seleção (coluna Disponíveis)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Disponíveis
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  // Envio individual: uma foto editada por tarefa
  const uploadRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadEditedResultItem[]>([]);
  // Tarefa-alvo do envio e a foto editada escolhida (preview antes de confirmar)
  const [sendTarget, setSendTarget] = useState<TaskItem | null>(null);
  const [sendFile, setSendFile] = useState<{ file: File; previewUrl: string } | null>(null);

  // Desistência modal
  const [abandonTarget, setAbandonTarget] = useState<TaskItem | null>(null);
  const [abandonReason, setAbandonReason] = useState("technical_issue");
  const [abandonCustom, setAbandonCustom] = useState("");
  const [abandoning, setAbandoning] = useState(false);
  const [abandonError, setAbandonError] = useState("");

  function loadBoard(silent = false) {
    if (!silent) setLoading(true);
    ApiClient.getEditorBoard(eventId)
      .then(setBoard)
      .catch((e: Error) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }

  useEffect(() => {
    if (eventId) loadBoard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Mantém o board atualizado (silencioso; pausa durante upload/download)
  useAutoRefresh(() => { if (eventId) loadBoard(true); }, { enabled: !sending && !downloading && !sendFile });

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

  // Clicou em "Enviar" no card → guarda a tarefa-alvo e abre o seletor de arquivo.
  function startSend(task: TaskItem) {
    setSendTarget(task);
    setUploadResults([]);
    uploadRef.current?.click();
  }

  // Escolheu o arquivo editado → abre o preview/confirmação (NÃO envia ainda).
  function handleFileChosen(fileList: FileList | null) {
    const file = fileList?.[0];
    // Zerar uploadRef.value esvazia o FileList vivo, então leia o arquivo antes.
    if (uploadRef.current) uploadRef.current.value = "";
    if (!file) return;
    setSendFile({ file, previewUrl: URL.createObjectURL(file) });
  }

  function cancelSend() {
    if (sendFile) URL.revokeObjectURL(sendFile.previewUrl);
    setSendFile(null);
    setSendTarget(null);
  }

  // Confirmação → envia a foto editada da tarefa-alvo, individualmente.
  async function confirmSend() {
    if (!sendFile) return;
    setSending(true);
    try {
      const data = await ApiClient.uploadEdited([sendFile.file]);
      setUploadResults(data.results);
      loadBoard();
    } catch (e: unknown) {
      setUploadResults([{
        filename: sendFile.file.name,
        success: false,
        media_version_id: null,
        fraud_detected: false,
        unlinked: false,
        error: e instanceof Error ? e.message : "Erro no upload.",
      }]);
    } finally {
      setSending(false);
      cancelSend();
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
      <div className="page-pad" style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 40px" }}>
        {/* Breadcrumb */}
        <nav className="ds-breadcrumb" style={{ marginBottom: 22 }}>
          <Link href="/dashboard">Início</Link>
          <span className="sep">›</span>
          <Link href={`/dashboard/${cityId}`}>Cidade</Link>
          <span className="sep">›</span>
          <span className="current">Kanban do Editor</span>
        </nav>

        {loading && <p className="ds-text-muted" style={{ fontSize: 13 }}>Carregando...</p>}
        {error && <p className="ds-alert ds-alert-danger">{error}</p>}

        {board && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── Coluna: Disponíveis ── */}
            <section className="ds-card-muted p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="ds-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  Disponíveis
                  <span className="ds-badge ds-badge-neutral">
                    {board.available.length}
                  </span>
                </h3>
                {board.available.length > 0 && (
                  <button onClick={toggleAll} className="ds-link" style={{ fontSize: 12 }}>
                    {selected.size === board.available.length ? "Desmarcar todos" : "Selecionar todos"}
                  </button>
                )}
              </div>

              {board.available.length === 0 && (
                <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhuma mídia disponível.</p>
              )}

              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {board.available.map((m: MediaItem, i: number) => (
                  <div
                    key={m.id}
                    className="ds-card ds-row-hover flex items-center gap-3 p-3 rounded-lg"
                  >
                    {/* Checkbox — zona independente */}
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggleSelect(m.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded flex-shrink-0 cursor-pointer"
                      style={{ accentColor: "var(--brand-primary)" }}
                    />
                    {/* Thumbnail + info — abre o preview em tela cheia */}
                    <button
                      onClick={() => setLightboxIndex(i)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <Thumbnail url={m.cloudinary_url} alt={m.original_filename} />
                      <div className="min-w-0">
                        <p className="ds-text-primary truncate" style={{ fontSize: 13, fontWeight: 600 }}>{m.original_filename}</p>
                        <p className="ds-text-muted" style={{ fontSize: 12 }}>{m.mime_type} · {formatSize(m.file_size)}</p>
                      </div>
                    </button>
                  </div>
                ))}
              </div>

              {downloadError && (
                <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 12, color: "var(--state-danger)" }}>{downloadError}</p>
              )}

              <button
                onClick={handleDownload}
                disabled={selected.size === 0 || downloading}
                className="ds-btn ds-btn-primary mt-4 w-full"
                style={{ padding: "9px 16px", justifyContent: "center" }}
              >
                {downloading
                  ? "Baixando..."
                  : `Baixar ${selected.size > 0 ? `(${selected.size})` : "selecionados"}`}
              </button>
            </section>

            {/* ── Coluna: Editando ── */}
            <section className="ds-card-muted p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="ds-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  Editando
                  <span className="ds-badge ds-badge-warning">
                    {board.editing.length}
                  </span>
                </h3>
              </div>

              <input
                ref={uploadRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => handleFileChosen(e.target.files)}
              />

              {uploadResults.length > 0 && (
                <div className="mb-3 space-y-1">
                  {uploadResults.map((r, i) => (
                    <div
                      key={i}
                      className={`ds-alert ${r.success ? "ds-alert-success" : "ds-alert-danger"}`}
                      style={{ fontSize: 12 }}
                    >
                      <span style={{ fontWeight: 600 }}>{r.filename}</span>
                      {r.success && " — enviado com sucesso"}
                      {r.fraud_detected && " — FRAUDE DETECTADA (arquivo idêntico ao original)"}
                      {r.unlinked && " — arquivo não identificado: mantenha o nome original do arquivo ao exportar"}
                      {r.error && !r.fraud_detected && !r.unlinked && ` — ${r.error}`}
                    </div>
                  ))}
                </div>
              )}

              {board.editing.length === 0 && (
                <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhum arquivo em edição.</p>
              )}

              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {board.editing.map((t: TaskItem) => (
                  <div
                    key={t.task_id}
                    className="ds-card rounded-lg overflow-hidden"
                    style={{ borderLeft: `3px solid ${t.is_revision ? "var(--state-danger)" : "var(--state-warning)"}` }}
                  >
                    {/* Área clicável para abrir drawer */}
                    <button
                      onClick={() => setDrawerMediaId(t.media_id)}
                      className="ds-row-hover flex items-center gap-3 w-full p-3 text-left"
                    >
                      <Thumbnail url={t.cloudinary_url} alt={t.original_filename} />
                      <div className="min-w-0 flex-1">
                        <p className="ds-text-primary truncate" style={{ fontSize: 13, fontWeight: 600 }}>{t.original_filename}</p>
                        <p className="ds-text-muted" style={{ fontSize: 12 }}>{t.mime_type} · {formatSize(t.file_size)}</p>
                        {t.is_revision && (
                          <span className="ds-badge ds-badge-danger" style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Ico d={IC.arrow} size={11} /> Devolvida para correção
                          </span>
                        )}
                      </div>
                    </button>
                    {/* Motivo da devolução pelo curador */}
                    {t.is_revision && t.feedback && (
                      <div
                        className="mx-3 mb-2 px-3 py-2 rounded"
                        style={{ background: "var(--bg-card-muted)", borderLeft: "2px solid var(--state-danger)" }}
                      >
                        <p className="ds-eyebrow" style={{ marginBottom: 2 }}>Motivo da rejeição</p>
                        <p className="ds-text-secondary" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{t.feedback}</p>
                      </div>
                    )}
                    {/* Ações da tarefa — envio individual desta foto */}
                    <div className="px-3 pb-2 flex items-center justify-between gap-3">
                      <button
                        onClick={() => startSend(t)}
                        disabled={sending}
                        className="ds-btn ds-btn-brand"
                        style={{ padding: "5px 12px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}
                      >
                        <Ico d={IC.upload} size={13} />
                        Enviar
                      </button>
                      <button
                        onClick={() => {
                          setAbandonTarget(t);
                          setAbandonReason("technical_issue");
                          setAbandonCustom("");
                          setAbandonError("");
                        }}
                        className="ds-link"
                        style={{ fontSize: 12, color: "var(--state-danger)" }}
                      >
                        Desistir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Coluna: Enviadas ── */}
            <section className="ds-card-muted p-5">
              <h3 className="ds-eyebrow mb-4" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                Enviadas
                <span className="ds-badge ds-badge-success">
                  {board.sent.length}
                </span>
              </h3>

              {board.sent.length === 0 && (
                <p className="ds-text-muted" style={{ fontSize: 13 }}>Nenhuma mídia enviada ainda.</p>
              )}

              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {board.sent.map((t: TaskItem) => (
                  <button
                    key={t.task_id}
                    onClick={() => setDrawerMediaId(t.media_id)}
                    className="ds-card ds-row-hover w-full flex items-center gap-3 p-3 rounded-lg text-left"
                    style={{ borderLeft: "3px solid var(--state-success)" }}
                  >
                    <Thumbnail url={t.cloudinary_url} alt={t.original_filename} />
                    <div className="min-w-0 flex-1">
                      <p className="ds-text-primary truncate" style={{ fontSize: 13, fontWeight: 600 }}>{t.original_filename}</p>
                      <p className="ds-text-muted" style={{ fontSize: 12 }}>{t.mime_type} · {formatSize(t.file_size)}</p>
                      <span className={`ds-badge ${SENT_BADGE[t.status]?.cls ?? "ds-badge-success"}`} style={{ marginTop: 4 }}>
                        {SENT_BADGE[t.status]?.label ?? "aguardando revisão"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── Modal de confirmação de envio (uma foto / uma tarefa) ── */}
        {sendFile && sendTarget && (
          <div className="fixed inset-0 flex items-start justify-center z-50 p-4 overflow-y-auto" style={{ background: "rgba(0,0,0,0.6)" }}>
            <div className="ds-card-emphasis rounded-2xl w-full max-w-3xl my-8" style={{ padding: 0 }}>
              <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <h4 className="ds-title" style={{ fontSize: 17 }}>Confirmar envio</h4>
                <button onClick={cancelSend} disabled={sending} className="ds-text-muted ds-hover flex items-center justify-center rounded" style={{ width: 32, height: 32 }} aria-label="Fechar">
                  <Ico d={IC.close} size={18} />
                </button>
              </div>

              <p className="ds-text-muted px-6 pt-4" style={{ fontSize: 13 }}>
                Confira a foto editada antes de enviar para revisão do curador. O original aparece ao lado para comparação.
              </p>

              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                <div className="ds-card rounded-lg p-4">
                  <p className="ds-text-primary truncate mb-1" style={{ fontSize: 13, fontWeight: 600 }}>{sendTarget.original_filename}</p>
                  <p className="ds-text-muted mb-3" style={{ fontSize: 12 }}>{sendFile.file.type || "image"} · {formatSize(sendFile.file.size)}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="ds-eyebrow mb-2">Original</p>
                      {sendTarget.cloudinary_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sendTarget.cloudinary_url} alt="Original" className="w-full rounded-lg object-contain max-h-64" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)" }} />
                      ) : (
                        <div className="w-full rounded-lg flex items-center justify-center ds-text-muted" style={{ height: 160, background: "var(--bg-card-muted)", border: "1px solid var(--border-subtle)", fontSize: 12, textAlign: "center", padding: 12 }}>
                          Sem prévia do original
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="ds-eyebrow mb-2">Editada (a enviar)</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={sendFile.previewUrl} alt="Editada" className="w-full rounded-lg object-contain max-h-64" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)" }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 px-6 py-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <button onClick={cancelSend} disabled={sending} className="ds-btn ds-btn-ghost flex-1" style={{ padding: "9px 16px", justifyContent: "center" }}>
                  Cancelar
                </button>
                <button onClick={confirmSend} disabled={sending} className="ds-btn ds-btn-brand flex-1" style={{ padding: "9px 16px", justifyContent: "center", gap: 6 }}>
                  {sending ? "Enviando..." : (<><Ico d={IC.upload} size={15} /> Confirmar e enviar</>)}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal de desistência ── */}
        {abandonTarget && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
            <div className="ds-card-emphasis rounded-2xl w-full max-w-md p-6">
              <h4 className="ds-title" style={{ fontSize: 17, marginBottom: 2 }}>Desistir da edição</h4>
              <p className="ds-text-muted truncate" style={{ fontSize: 13, marginBottom: 16 }}>{abandonTarget.original_filename}</p>

              <label className="ds-text-secondary" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Motivo</label>
              <select
                value={abandonReason}
                onChange={(e) => setAbandonReason(e.target.value)}
                className="ds-select w-full"
                style={{ marginBottom: 12 }}
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
                  className="ds-text-input w-full resize-none"
                  style={{ marginBottom: 12 }}
                />
              )}

              {abandonError && (
                <p style={{ fontSize: 12, color: "var(--state-danger)", marginBottom: 12 }}>{abandonError}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setAbandonTarget(null)}
                  className="ds-btn ds-btn-ghost flex-1"
                  style={{ padding: "9px 16px", justifyContent: "center" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAbandon}
                  disabled={abandoning}
                  className="ds-btn ds-btn-danger flex-1"
                  style={{ padding: "9px 16px", justifyContent: "center" }}
                >
                  {abandoning ? "Abandonando..." : "Confirmar desistência"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drawer global — fora do main para não conflitar com z-index */}
      <PhotoDrawer
        mediaId={drawerMediaId}
        onClose={() => setDrawerMediaId(null)}
      />

      {/* Lightbox de preview/seleção das mídias disponíveis */}
      <PhotoLightbox
        items={(board?.available ?? []).map((m) => ({
          id: m.id,
          url: m.cloudinary_url,
          filename: m.original_filename,
        }))}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
        selectedIds={selected}
        onToggleSelect={toggleSelect}
      />
    </>
  );
}
