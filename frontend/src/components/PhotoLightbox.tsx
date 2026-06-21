"use client";

import { useCallback, useEffect } from "react";
import { IC, Ico } from "@/components/icons";

export interface LightboxItem {
  id: number;
  url?: string | null;
  filename: string;
}

interface PhotoLightboxProps {
  items: LightboxItem[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Habilita seleção dentro do modal (ex.: editor escolhendo o que editar). */
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}

/**
 * Lightbox de preview reutilizável.
 * - Navega entre `items` por ← → (teclado) ou pelos chevrons.
 * - Esc fecha. Espaço/Enter alterna seleção (quando habilitada).
 * - Usa a thumbnail do Cloudinary (`item.url`).
 */
export default function PhotoLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  selectedIds,
  onToggleSelect,
}: PhotoLightboxProps) {
  const open = index !== null && index >= 0 && index < items.length;
  const item = open ? items[index] : null;
  const selectable = !!onToggleSelect;
  const isSelected = !!(item && selectedIds?.has(item.id));

  const goPrev = useCallback(() => {
    if (index === null) return;
    onIndexChange(Math.max(0, index - 1));
  }, [index, onIndexChange]);

  const goNext = useCallback(() => {
    if (index === null) return;
    onIndexChange(Math.min(items.length - 1, index + 1));
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); return; }
      if (selectable && item && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        onToggleSelect!(item.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, item, selectable, goPrev, goNext, onClose, onToggleSelect]);

  if (!open || !item) return null;

  const hasPrev = index! > 0;
  const hasNext = index! < items.length - 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "var(--bg-overlay, rgba(0,0,0,0.85))",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Topo: nome + posição + ações */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 18px",
          color: "var(--text-on-brand, #fff)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.filename}
          </p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>{index! + 1} / {items.length}</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selectable && (
            <button
              onClick={() => onToggleSelect!(item.id)}
              className={isSelected ? "ds-btn ds-btn-brand" : "ds-btn ds-btn-ghost"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Ico d={IC.check} size={16} />
              {isSelected ? "Selecionada" : "Selecionar"}
            </button>
          )}
          <button onClick={onClose} aria-label="Fechar" className="ds-btn ds-btn-ghost" style={{ padding: 8 }}>
            <Ico d={IC.close} size={18} />
          </button>
        </div>
      </div>

      {/* Corpo: setas + imagem */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 8px 8px", minHeight: 0 }}
      >
        <button
          onClick={goPrev}
          disabled={!hasPrev}
          aria-label="Anterior"
          className="ds-btn ds-btn-ghost"
          style={{ padding: 10, opacity: hasPrev ? 1 : 0.3, color: "var(--text-on-brand, #fff)" }}
        >
          <Ico d={IC.chevL} size={26} />
        </button>

        <div style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0 }}>
          {item.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.url}
              alt={item.filename}
              onClick={() => selectable && onToggleSelect!(item.id)}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: "var(--radius, 8px)",
                cursor: selectable ? "pointer" : "default",
                boxShadow: isSelected ? "0 0 0 4px var(--brand-primary)" : "none",
              }}
            />
          ) : (
            <div style={{ color: "var(--text-on-brand, #fff)", opacity: 0.6, textAlign: "center" }}>
              <Ico d={IC.image} size={48} />
              <p style={{ fontSize: 13, marginTop: 8 }}>Thumbnail não disponível</p>
            </div>
          )}
        </div>

        <button
          onClick={goNext}
          disabled={!hasNext}
          aria-label="Próxima"
          className="ds-btn ds-btn-ghost"
          style={{ padding: 10, opacity: hasNext ? 1 : 0.3, color: "var(--text-on-brand, #fff)" }}
        >
          <Ico d={IC.chevR} size={26} />
        </button>
      </div>
    </div>
  );
}
