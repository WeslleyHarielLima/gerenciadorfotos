import { ApiClient } from "@/lib/api";

/**
 * Baixa um arquivo servido pelo proxy do Drive e dispara o download no navegador.
 * Faz o fetch autenticado (a tag <a download> não envia o header Authorization),
 * converte em blob e salva com o nome informado.
 */
export async function downloadProxyFile(proxyUrl: string, filename: string): Promise<void> {
  const blob = await ApiClient.downloadProxy(proxyUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
