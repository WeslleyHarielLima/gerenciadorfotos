import { AuthResponse, User, UserRole } from "@/lib/types";

const ACCESS_KEY = "wf_access";
const REFRESH_KEY = "wf_refresh";
const USER_KEY = "wf_user";

export function saveAuth(data: AuthResponse): void {
  localStorage.setItem(ACCESS_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
}

export function loadAuth(): { accessToken: string | null; refreshToken: string | null; user: User | null } {
  if (typeof window === "undefined") {
    return { accessToken: null, refreshToken: null, user: null };
  }
  const raw = localStorage.getItem(USER_KEY);
  return {
    accessToken: localStorage.getItem(ACCESS_KEY),
    refreshToken: localStorage.getItem(REFRESH_KEY),
    user: raw ? (JSON.parse(raw) as User) : null,
  };
}

export function clearAuth(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function dashboardPathForRole(_role: UserRole): string {
  return "/dashboard";
}
