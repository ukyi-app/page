import { useState, type FormEvent } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ApiError } from "../lib/api";
import { KeyIcon, SpinnerIcon, TerminalIcon, UserIcon } from "../lib/icons";
import { DEFAULT_ADMIN_ID, useAuth } from "../hooks/useAuth";

export function LoginScreen() {
  const { login } = useAuth();
  const [id, setId] = useState(DEFAULT_ADMIN_ID);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await login(id.trim() || DEFAULT_ADMIN_ID, token);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.isUnauthorized
            ? "토큰이 올바르지 않습니다."
            : err.code === "network_error"
              ? "서버에 연결할 수 없습니다."
              : `오류: ${err.code}`,
        );
      } else {
        setError("알 수 없는 오류가 발생했습니다.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm animate-pop p-7">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary glow-ring">
            <TerminalIcon className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              page <span className="text-muted-foreground">·</span> admin
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">HTML 페이지 관리 콘솔</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-id">관리자 ID</Label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoComplete="username"
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-token">관리 토큰</Label>
            <div className="relative">
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="current-password"
                placeholder="Bearer 토큰"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || !token} className="mt-1 w-full">
            {busy ? <SpinnerIcon className="size-4" /> : null}
            {busy ? "확인 중…" : "로그인"}
          </Button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          토큰은 온보딩 때 생성해 비밀번호 관리자에 저장한 관리 토큰입니다.
          <br />
          서버에는 해시만 저장되어 복구할 수 없습니다.
        </p>
      </Card>
    </div>
  );
}
