"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { IC, Ico } from "@/components/icons";
import PhotoLightbox from "@/components/PhotoLightbox";
import { Event, EventMediaItem, EventUploadStats, UploadResultItem } from "@/lib/types";

interface FileItem {
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  result?: UploadResultItem;
}

export default function UploaderPage() {
  const router = useRouter();
  const params = useParams();
  const cityId = Number(params.cityId);
  const eventId = Number(params.eventId);

  const [event, setEvent] = useState<Event | null>(null);
  const [stats, setStats] = useState<EventUploadStats | null>(null);
  const [eventMedia, setEventMedia] = useState<EventMediaItem[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const { user } = loadAuth();
    if (!user) { router.replace("/"); return; }
    if (user.role !== "uploader" && user.role !== "admin") {
      router.replace("/dashboard");
      return;
    }
    if (!cityId || !eventId || isNaN(cityId) || isNaN(eventId)) {
      router.replace("/dashboard");
      return;
    }
    ApiClient.getEvents(cityId)
      .then((events) => {
        const ev = events.find((e) => e.id === eventId);
        if (!ev) { setLoadError("Evento não encontrado ou inativo."); return; }
        setEvent(ev);
        ApiClient.getEventUploadStats(eventId).then(setStats).catch(() => {});
        ApiClient.getEventMedia(eventId).then(setEventMedia).catch(() => {});
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [cityId, eventId, router]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const ACCEPTED = [
      "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
      "video/mp4", "video/quicktime", "video/x-msvideo", "video/x-matroska",
    ];
    const next: FileItem[] = [];
    Array.from(incoming).forEach((f) => {
      if (!ACCEPTED.includes(f.type)) return;
      const preview = f.type.startsWith("image/")
        ? URL.createObjectURL(f)
        : "";
      next.push({ file: f, preview, status: "pending" });
    });
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  function removeFile(idx: number) {
    setFiles((prev) => {
      const copy = [...prev];
      if (copy[idx].preview) URL.revokeObjectURL(copy[idx].preview);
      copy.splice(idx, 1);
      return copy;
    });
  }

  async function handleUpload() {
    const pending = files.filter((f) => f.status === "pending");
    if (!pending.length || !event) return;
    setUploading(true);
    setProgress({ done: 0, total: pending.length });

    setFiles((prev) =>
      prev.map((f) => (f.status === "pending" ? { ...f, status: "uploading" } : f)),
    );

    try {
      const response = await ApiClient.uploadMedia(
        event.id,
        pending.map((f) => f.file),
        (done, total) => setProgress({ done, total }),
      );

      const resultMap = new Map<string, UploadResultItem>();
      response.results.forEach((r) => resultMap.set(r.filename, r));

      setFiles((prev) =>
        prev.map((item) => {
          if (item.status !== "uploading") return item;
          const r = resultMap.get(item.file.name);
          return {
            ...item,
            status: r?.success ? "done" : "error",
            result: r,
          };
        }),
      );

      ApiClient.getEventUploadStats(event.id).then(setStats).catch(() => {});
      ApiClient.getEventMedia(event.id).then(setEventMedia).catch(() => {});
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "uploading"
            ? { ...f, status: "error", result: { filename: f.file.name, success: false, media_id: null, error: String(err) } }
            : f,
        ),
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteMedia(m: EventMediaItem) {
    if (m.status !== "uploaded" || deletingId) return;
    if (!window.confirm(`Remover "${m.original_filename}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(m.id);
    try {
      await ApiClient.deleteMedia(m.id);
      setEventMedia((prev) => prev.filter((x) => x.id !== m.id));
      if (lightboxIndex !== null) setLightboxIndex(null);
      if (event) ApiClient.getEventUploadStats(event.id).then(setStats).catch(() => {});
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao remover a mídia.");
    } finally {
      setDeletingId(null);
    }
  }

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 28px 40px" }}>
      <nav className="ds-breadcrumb" style={{ marginBottom: 20 }}>
        <Link href="/dashboard">Início</Link>
        <span className="sep">›</span>
        <Link href={`/dashboard/${cityId}`}>{event?.city_name ?? "Cidade"}</Link>
        <span className="sep">›</span>
        <span className="current">{event?.name ?? "Evento"}</span>
      </nav>

      <h2 className="ds-title" style={{ marginBottom: 6 }}>Enviar fotos/vídeos</h2>
      {event && (
        <p className="ds-text-muted" style={{ fontSize: 13, marginBottom: 12 }}>{event.name}</p>
      )}
      {stats && (
        <div className="ds-badge ds-badge-info" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 24 }}>
          <span style={{ fontWeight: 700 }}>{stats.total}</span>
          foto{stats.total !== 1 ? "s" : ""} já enviada{stats.total !== 1 ? "s" : ""} neste evento
          {stats.in_pool > 0 && (
            <span className="ds-text-muted">· {stats.in_pool} aguardando edição</span>
          )}
        </div>
      )}

      {loadError && (
        <div className="ds-alert ds-alert-danger" style={{ marginBottom: 24 }}>
          {loadError}
        </div>
      )}

      {!loadError && (
        <>
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="rounded-xl p-12 text-center cursor-pointer mb-6"
            style={{
              border: `2px dashed ${dragOver ? "var(--brand-primary)" : "var(--border-default)"}`,
              background: dragOver ? "var(--bg-card-emphasis)" : "var(--bg-card-muted)",
              transition: "var(--tr)",
            }}
          >
            <Ico d={IC.upload} size={28} />
            <p className="ds-text-secondary" style={{ fontSize: 13, marginTop: 8 }}>
              Arraste fotos ou vídeos aqui, ou{" "}
              <span className="ds-link" style={{ fontWeight: 600 }}>clique para selecionar</span>
            </p>
            <p className="ds-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              JPEG · PNG · WEBP · HEIC · MP4 · MOV · AVI · MKV
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska"
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {/* Lista de arquivos */}
          {files.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="ds-text-secondary" style={{ fontSize: 13 }}>
                  {files.length} arquivo{files.length !== 1 ? "s" : ""}
                  {doneCount > 0 && ` · ${doneCount} enviado${doneCount !== 1 ? "s" : ""}`}
                  {errorCount > 0 && ` · ${errorCount} com erro`}
                </p>
                {pendingCount > 0 && !uploading && (
                  <button
                    onClick={handleUpload}
                    className="ds-btn ds-btn-primary"
                    style={{ padding: "9px 18px", fontSize: 13 }}
                  >
                    Enviar {pendingCount} arquivo{pendingCount !== 1 ? "s" : ""}
                  </button>
                )}
                {uploading && (
                  <span className="ds-text-secondary" style={{ fontSize: 13 }}>
                    Enviando… {progress.done}/{progress.total}
                  </span>
                )}
              </div>

              {/* Barra de progresso */}
              {uploading && (
                <div className="w-full rounded-full h-1.5 mb-4" style={{ background: "var(--bg-card-emphasis)" }}>
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: "var(--brand-primary)" }}
                  />
                </div>
              )}

              <div className="space-y-2">
                {files.map((item, idx) => (
                  <div
                    key={idx}
                    className="ds-card flex items-center gap-3"
                    style={{ padding: "12px 16px" }}
                  >
                    {/* Miniatura */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: "var(--bg-card-emphasis)" }}>
                      {item.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.preview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">🎬</span>
                      )}
                    </div>

                    {/* Nome e tamanho */}
                    <div className="min-w-0 flex-1">
                      <p className="ds-text-primary truncate" style={{ fontSize: 13, fontWeight: 600 }}>{item.file.name}</p>
                      <p className="ds-text-muted" style={{ fontSize: 12 }}>
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                      {item.status === "error" && item.result?.error && (
                        <p style={{ fontSize: 12, marginTop: 2, color: "var(--state-danger)" }}>{item.result.error}</p>
                      )}
                    </div>

                    {/* Status */}
                    <div className="shrink-0">
                      {item.status === "pending" && (
                        <button
                          onClick={() => removeFile(idx)}
                          className="ds-text-muted"
                          style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", transition: "var(--tr)" }}
                          disabled={uploading}
                        >
                          Remover
                        </button>
                      )}
                      {item.status === "uploading" && (
                        <span className="ds-text-secondary" style={{ fontSize: 12 }}>Enviando…</span>
                      )}
                      {item.status === "done" && (
                        <span className="ds-badge ds-badge-success">Enviado</span>
                      )}
                      {item.status === "error" && (
                        <span className="ds-badge ds-badge-danger">Erro</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Galeria do que já foi enviado neste evento */}
          {eventMedia.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h3 className="ds-eyebrow" style={{ marginBottom: 12 }}>
                Enviadas neste evento ({eventMedia.length})
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
                  gap: 10,
                }}
              >
                {eventMedia.map((m, i) => (
                  <div
                    key={m.id}
                    className="ds-card ds-row-hover"
                    style={{ position: "relative", padding: 0, overflow: "hidden", aspectRatio: "1 / 1" }}
                  >
                    <button
                      onClick={() => setLightboxIndex(i)}
                      title={m.original_filename}
                      style={{ display: "block", width: "100%", height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer" }}
                    >
                      {m.cloudinary_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.cloudinary_url} alt={m.original_filename}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", background: "var(--bg-card-muted)" }}>
                          <Ico d={IC.image} size={20} />
                        </div>
                      )}
                    </button>
                    {m.status === "uploaded" && (
                      <button
                        onClick={() => handleDeleteMedia(m)}
                        disabled={deletingId === m.id}
                        title="Remover esta mídia"
                        aria-label="Remover esta mídia"
                        style={{
                          position: "absolute", top: 6, right: 6,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, borderRadius: 8, border: "none",
                          background: "rgba(0,0,0,0.55)", color: "#fff",
                          cursor: deletingId === m.id ? "wait" : "pointer",
                          opacity: deletingId === m.id ? 0.6 : 1, transition: "var(--tr)",
                        }}
                      >
                        <Ico d={IC.trash} size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Lightbox de preview (apenas conferência — sem seleção) */}
      <PhotoLightbox
        items={eventMedia.map((m) => ({
          id: m.id,
          url: m.cloudinary_url,
          filename: m.original_filename,
        }))}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}
