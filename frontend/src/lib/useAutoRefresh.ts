import { useEffect, useRef } from "react";

/**
 * Chama `fn` periodicamente (default 20s) e sempre que a aba volta ao foco.
 * Mantém os boards atualizados sem o usuário recarregar a página.
 *
 * Usa um ref para sempre executar a versão mais recente de `fn` sem reiniciar
 * o intervalo a cada render. Passe `enabled: false` para pausar (ex.: modal aberto).
 */
export function useAutoRefresh(
  fn: () => void,
  opts?: { intervalMs?: number; enabled?: boolean },
) {
  const { intervalMs = 20000, enabled = true } = opts ?? {};
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => fnRef.current();
    const id = setInterval(tick, intervalMs);
    const onFocus = () => fnRef.current();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs]);
}
