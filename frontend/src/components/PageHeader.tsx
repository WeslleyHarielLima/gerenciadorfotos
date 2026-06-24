"use client";

import { useRouter } from "next/navigation";
import { IC, Ico } from "@/components/icons";

/**
 * Cabeçalho de tela interna: botão "Voltar" + título grande.
 * Substitui o breadcrumb por algo mais direto para quem está
 * começando a usar tecnologia.
 */
export default function PageHeader({
  title,
  subtitle,
  backHref,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
}) {
  const router = useRouter();
  return (
    <div style={{ marginBottom: 22 }}>
      <button
        onClick={() => (backHref ? router.push(backHref) : router.back())}
        className="ds-btn ds-btn-ghost"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", marginBottom: 12 }}
      >
        <Ico d={IC.chevL} size={16} /> Voltar
      </button>
      <h2 className="ds-title">{title}</h2>
      {subtitle && (
        <p className="ds-text-muted" style={{ fontSize: 13, marginTop: 4 }}>{subtitle}</p>
      )}
    </div>
  );
}
