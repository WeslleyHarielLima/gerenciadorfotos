import { AuthResponse, City, Event, RefreshResponse, UploadResponse, User } from "@/lib/types";
import { clearAuth, getAccessToken, getRefreshToken, saveAuth } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

async function refreshSilently(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      clearAuth();
      return null;
    }
    const data: RefreshResponse = await res.json();
    localStorage.setItem("wf_access", data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    token = await refreshSilently();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
      res = await fetch(`${BASE}${path}`, { ...init, headers });
    }
  }
  return res;
}

export const ApiClient = {
  async login(username: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail ?? "Credenciais inválidas.");
    }
    const data: AuthResponse = await res.json();
    saveAuth(data);
    return data;
  },

  async me(): Promise<User> {
    const res = await apiFetch("/auth/me");
    if (!res.ok) throw new Error("Não autenticado.");
    return res.json();
  },

  async getCities(): Promise<City[]> {
    const res = await apiFetch("/dashboard/cities");
    if (!res.ok) throw new Error("Erro ao carregar cidades.");
    return res.json();
  },

  async getEvents(cityId: number): Promise<Event[]> {
    const res = await apiFetch(`/dashboard/cities/${cityId}/events`);
    if (!res.ok) throw new Error("Erro ao carregar eventos.");
    return res.json();
  },

  async uploadMedia(
    eventId: number,
    files: File[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<UploadResponse> {
    const BATCH = 10;
    const allResults: UploadResponse["results"] = [];
    let done = 0;

    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const form = new FormData();
      form.append("event_id", String(eventId));
      batch.forEach((f) => form.append("files", f));

      const res = await apiFetch("/media/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? "Falha no upload.");
      }
      const data: UploadResponse = await res.json();
      allResults.push(...data.results);
      done += batch.length;
      onProgress?.(done, files.length);
    }

    return { results: allResults };
  },

  fetch: apiFetch,
};
