import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createApi, type Api } from "../lib/api";

const TOKEN_KEY = "page-admin.token";
const ID_KEY = "page-admin.id";
export const DEFAULT_ADMIN_ID = "ukkiee";

type AuthState = { id: string; api: Api } | null;

type AuthContextValue = {
  auth: AuthState;
  login: (id: string, token: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    return { id: sessionStorage.getItem(ID_KEY) ?? DEFAULT_ADMIN_ID, api: createApi(token) };
  });

  const login = useCallback(async (id: string, token: string) => {
    const api = createApi(token);
    // 토큰 검증: 가드로 보호된 목록 호출이 통과하면 유효한 토큰.
    await api.listPages();
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(ID_KEY, id);
    setAuth({ id, api });
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ID_KEY);
    setAuth(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ auth, login, logout }), [auth, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
