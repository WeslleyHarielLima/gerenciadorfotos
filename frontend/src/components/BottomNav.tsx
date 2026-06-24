"use client";

import Link from "next/link";
import { Ico } from "@/components/icons";

export interface BottomNavItem {
  id: string;
  label: string;
  href: string;
  icon: string | string[];
}

/**
 * Barra de abas inferior (mobile). Sempre visível, ícone + texto.
 * No desktop fica oculta por CSS (a sidebar assume a navegação).
 */
export default function BottomNav({
  items,
  pathname,
}: {
  items: BottomNavItem[];
  pathname: string;
}) {
  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      {items.map((item) => {
        const active =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            className="bottom-nav-item"
            data-active={active}
          >
            <Ico d={item.icon} size={22} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
