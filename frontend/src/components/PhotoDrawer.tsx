"use client";

import { useEffect, useState } from "react";
import { MediaDetail } from "@/lib/types";
import { getAccessToken } from "@/lib/auth";
import { IC, Ico } from "@/components/icons";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Aguardando edição",
  selected_for_edit: "Em edição",
  pending_review: "Em revisão",
  approved: "Aprovado",
  published: "Publicado",
  rejected_final: "Rejeitado",
};

const STATUS_BADGE: Record<string, string> = {
  uploaded: "ds-badge-neutral",
  selected_for_edit: "ds-badge-info",
  pending_review: "ds-badge-warning",
  approved: "ds-badge-success",
  published: "ds-badge-success",
  rejected_final: "ds-badge-danger",
};

const VERSION_STATUS_LABELS: Record<string, string> = {
  original: "Original",
  edited: "Editada",
  approved: "Aprovada",
  rejected: "Rejeitada",
};

const VERSION_STATUS_BADGE: Record<string, string> = {
  approved: "ds-badge-success",
  rejected: "ds-badge-danger",
  original: "ds-badge-neutral",
  edited: "ds-badge-info",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface PhotoDrawerProps {
  mediaId: number | null;
  onClose: () => void;
}

export default function PhotoDrawer({ mediaId, onClose }: PhotoDrawerProps) {
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mediaId) { setDetail(null); return; }
    setLoading(true);
    const token = getAccessToken();
    fetch(`${API_BASE}/media/${mediaId}/detail`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [mediaId]);

  // Fechar com Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const open = mediaId !== null;

  return (
    <>
      {/* Overlay semitransparente */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{ background: "var(--bg-overlay)" }}
        onClick={onClose}
      />

      {/* Painel deslizante */}
      <aside
        className={`fixed top-0 right-0 h-full w-full max-w-lg z-50 flex flex-col transform transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{
          background: "var(--bg-card)",
          borderLeft: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-notif)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="ds-text-primary truncate max-w-xs" style={{ fontSize: 14, fontWeight: 600 }}>
            {detail ? detail.original_filename : "Carregando…"}
          </span>
          <button
            onClick={onClose}
            className="ds-text-muted ds-hover ml-4 flex-shrink-0 flex items-center justify-center rounded"
            style={{ width: 30, height: 30 }}
            aria-label="Fechar"
          >
            <Ico d={IC.close} size={18} />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="ds-text-muted flex items-center justify-center h-48" style={{ fontSize: 13 }}>
              Carregando…
            </div>
          )}

          {!loading && detail && (
            <>
              {/* Foto */}
              <div
                className="flex items-center justify-center p-4"
                style={{ background: "var(--bg-card-muted)" }}
              >
                {detail.cloudinary_url ? (
                  <img
                    src={detail.cloudinary_url}
                    alt={detail.original_filename}
                    className="max-h-80 max-w-full object-contain rounded"
                    style={{ boxShadow: "var(--shadow-notif)" }}
                  />
                ) : (
                  <div className="ds-text-muted flex flex-col items-center justify-center h-48 gap-2">
                    <Ico d={IC.image} size={40} />
                    <span style={{ fontSize: 12 }}>Thumbnail não disponível</span>
                  </div>
                )}
              </div>

              {/* Metadados */}
              <div className="px-5 py-4 space-y-4">
                {/* Status */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`ds-badge ${STATUS_BADGE[detail.status] ?? "ds-badge-neutral"}`}>
                    {STATUS_LABELS[detail.status] ?? detail.status}
                  </span>
                  <span className="ds-text-muted" style={{ fontSize: 12 }}>{detail.mime_type}</span>
                  <span className="ds-text-muted" style={{ fontSize: 12 }}>{formatBytes(detail.file_size)}</span>
                </div>

                {/* Evento */}
                <div>
                  <p className="ds-eyebrow" style={{ marginBottom: 4 }}>Evento</p>
                  <p className="ds-text-primary" style={{ fontSize: 14, fontWeight: 600 }}>{detail.event_name}</p>
                  <p className="ds-text-secondary" style={{ fontSize: 12 }}>{detail.city_name}</p>
                </div>

                {/* Uploader / Data */}
                <div className="flex gap-6">
                  <div>
                    <p className="ds-eyebrow" style={{ marginBottom: 4 }}>Enviado por</p>
                    <p className="ds-text-primary" style={{ fontSize: 14 }}>{detail.uploaded_by}</p>
                  </div>
                  <div>
                    <p className="ds-eyebrow" style={{ marginBottom: 4 }}>Data de upload</p>
                    <p className="ds-text-primary" style={{ fontSize: 14 }}>{formatDateTime(detail.created_at)}</p>
                  </div>
                </div>

                {/* Histórico de versões */}
                <div>
                  <p className="ds-eyebrow" style={{ marginBottom: 8 }}>Histórico de versões</p>
                  <div className="space-y-2">
                    {detail.versions.map((v) => (
                      <div key={v.version} className="flex items-start gap-3" style={{ fontSize: 14 }}>
                        <span
                          className="ds-card-muted ds-text-secondary flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                          style={{ fontSize: 12, fontWeight: 600 }}
                        >
                          v{v.version}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`ds-badge ${VERSION_STATUS_BADGE[v.status] ?? "ds-badge-info"}`}>
                              {VERSION_STATUS_LABELS[v.status] ?? v.status}
                            </span>
                            <span className="ds-text-muted" style={{ fontSize: 12 }}>{formatBytes(v.file_size)}</span>
                          </div>
                          <p className="ds-text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
                            {v.edited_by ? `por ${v.edited_by} · ` : ""}{formatDateTime(v.edited_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
