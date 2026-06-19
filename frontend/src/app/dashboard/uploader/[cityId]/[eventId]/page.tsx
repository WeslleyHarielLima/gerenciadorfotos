"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { loadAuth } from "@/lib/auth";
import { ApiClient } from "@/lib/api";
import { Event, UploadResultItem } from "@/lib/types";

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
  const [loadError, setLoadError] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);
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

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <nav className="text-sm text-gray-500 mb-6 flex items-center gap-2 flex-wrap">
        <Link href="/dashboard" className="hover:text-blue-600 transition-colors">Início</Link>
        <span className="text-gray-300">›</span>
        <Link href={`/dashboard/${cityId}`} className="hover:text-blue-600 transition-colors">
          {event?.city_name ?? "Cidade"}
        </Link>
        <span className="text-gray-300">›</span>
        <span className="text-gray-800 font-medium">{event?.name ?? "Evento"}</span>
      </nav>

      <h2 className="text-xl font-semibold text-gray-800 mb-1">Enviar fotos/vídeos</h2>
      {event && (
        <p className="text-sm text-gray-500 mb-6">{event.name}</p>
      )}

      {loadError && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm mb-6">
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
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors mb-6
              ${dragOver
                ? "border-blue-400 bg-blue-50"
                : "border-gray-300 bg-gray-50 hover:border-blue-300 hover:bg-gray-100"
              }`}
          >
            <p className="text-gray-500 text-sm">
              Arraste fotos ou vídeos aqui, ou{" "}
              <span className="text-blue-600 font-medium">clique para selecionar</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
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
                <p className="text-sm text-gray-600">
                  {files.length} arquivo{files.length !== 1 ? "s" : ""}
                  {doneCount > 0 && ` · ${doneCount} enviado${doneCount !== 1 ? "s" : ""}`}
                  {errorCount > 0 && ` · ${errorCount} com erro`}
                </p>
                {pendingCount > 0 && !uploading && (
                  <button
                    onClick={handleUpload}
                    className="bg-blue-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Enviar {pendingCount} arquivo{pendingCount !== 1 ? "s" : ""}
                  </button>
                )}
                {uploading && (
                  <span className="text-sm text-blue-600">
                    Enviando… {progress.done}/{progress.total}
                  </span>
                )}
              </div>

              {/* Barra de progresso */}
              {uploading && (
                <div className="w-full bg-gray-200 rounded-full h-1.5 mb-4">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              )}

              <div className="space-y-2">
                {files.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3"
                  >
                    {/* Miniatura */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                      {item.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.preview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">🎬</span>
                      )}
                    </div>

                    {/* Nome e tamanho */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.file.name}</p>
                      <p className="text-xs text-gray-400">
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                      {item.status === "error" && item.result?.error && (
                        <p className="text-xs text-red-600 mt-0.5">{item.result.error}</p>
                      )}
                    </div>

                    {/* Status */}
                    <div className="shrink-0">
                      {item.status === "pending" && (
                        <button
                          onClick={() => removeFile(idx)}
                          className="text-gray-400 hover:text-red-500 text-xs transition-colors"
                          disabled={uploading}
                        >
                          Remover
                        </button>
                      )}
                      {item.status === "uploading" && (
                        <span className="text-xs text-blue-500">Enviando…</span>
                      )}
                      {item.status === "done" && (
                        <span className="text-xs text-green-600 font-medium">Enviado</span>
                      )}
                      {item.status === "error" && (
                        <span className="text-xs text-red-600 font-medium">Erro</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
