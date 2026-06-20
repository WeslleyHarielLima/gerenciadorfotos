"use client";

import { useEffect, useState } from "react";
import { MediaDetail } from "@/lib/types";
import { getAccessToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Aguardando edição",
  selected_for_edit: "Em edição",
  pending_review: "Em revisão",
  approved: "Aprovado",
  published: "Publicado",
  rejected_final: "Rejeitado",
};

const STATUS_COLORS: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  selected_for_edit: "bg-blue-100 text-blue-700",
  pending_review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  published: "bg-emerald-100 text-emerald-700",
  rejected_final: "bg-red-100 text-red-700",
};

const VERSION_STATUS_LABELS: Record<string, string> = {
  original: "Original",
  edited: "Editada",
  approved: "Aprovada",
  rejected: "Rejeitada",
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
        className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Painel deslizante */}
      <aside
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <span className="text-sm font-semibold text-gray-700 truncate max-w-xs">
            {detail ? detail.original_filename : "Carregando…"}
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none ml-4 flex-shrink-0"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {/* Corpo com scroll */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              Carregando…
            </div>
          )}

          {!loading && detail && (
            <>
              {/* Foto */}
              <div className="bg-gray-50 flex items-center justify-center p-4">
                {detail.cloudinary_url ? (
                  <img
                    src={detail.cloudinary_url}
                    alt={detail.original_filename}
                    className="max-h-80 max-w-full object-contain rounded shadow"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
                    <span className="text-5xl">🖼</span>
                    <span className="text-xs">Thumbnail não disponível</span>
                  </div>
                )}
              </div>

              {/* Metadados */}
              <div className="px-5 py-4 space-y-4">
                {/* Status */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[detail.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {STATUS_LABELS[detail.status] ?? detail.status}
                  </span>
                  <span className="text-xs text-gray-400">{detail.mime_type}</span>
                  <span className="text-xs text-gray-400">{formatBytes(detail.file_size)}</span>
                </div>

                {/* Evento */}
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Evento</p>
                  <p className="text-sm text-gray-800 font-medium">{detail.event_name}</p>
                  <p className="text-xs text-gray-500">{detail.city_name}</p>
                </div>

                {/* Uploader / Data */}
                <div className="flex gap-6">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Enviado por</p>
                    <p className="text-sm text-gray-800">{detail.uploaded_by}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Data de upload</p>
                    <p className="text-sm text-gray-800">{formatDateTime(detail.created_at)}</p>
                  </div>
                </div>

                {/* Histórico de versões */}
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Histórico de versões</p>
                  <div className="space-y-2">
                    {detail.versions.map((v) => (
                      <div key={v.version} className="flex items-start gap-3 text-sm">
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center font-semibold">
                          v{v.version}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              v.status === "approved" ? "bg-green-100 text-green-700" :
                              v.status === "rejected" ? "bg-red-100 text-red-700" :
                              v.status === "original" ? "bg-gray-100 text-gray-600" :
                              "bg-blue-100 text-blue-700"
                            }`}>
                              {VERSION_STATUS_LABELS[v.status] ?? v.status}
                            </span>
                            <span className="text-xs text-gray-400">{formatBytes(v.file_size)}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
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
