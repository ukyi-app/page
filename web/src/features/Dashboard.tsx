import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useToast } from "../components/ui/toast";
import { useAuth } from "../hooks/useAuth";
import { useErrorToast } from "../hooks/useErrorToast";
import { ApiError } from "../lib/api";
import { describeApiError } from "../lib/errors";
import { timeUntil } from "../lib/format";
import { LogoutIcon, PlusIcon, RefreshIcon, SpinnerIcon, TerminalIcon, UserIcon } from "../lib/icons";
import type { PageListItem } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { PageEditorDialog, type EditorTarget } from "./PageEditorDialog";
import { PagesTable } from "./PagesTable";
import { RevisionsDialog } from "./RevisionsDialog";

type ConfirmState = { kind: "delete" | "restore"; page: PageListItem } | null;

export function Dashboard() {
  const { auth, logout } = useAuth();
  const api = auth!.api;
  const toast = useToast();
  const handleError = useErrorToast();

  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; target: EditorTarget }>({
    open: false,
    target: { mode: "create" },
  });
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [history, setHistory] = useState<PageListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPages(await api.listPages());
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        handleError(err);
        return;
      }
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
    // api는 세션 내 안정적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = pages.filter((p) => p.disabledAt === null).length;
  const disabledCount = pages.length - activeCount;

  function openCreate() {
    setEditor({ open: true, target: { mode: "create" } });
  }
  function openEdit(path: string) {
    setEditor({ open: true, target: { mode: "edit", path } });
  }
  function openRendered(path: string) {
    window.open(path, "_blank", "noopener,noreferrer");
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, page } = confirm;
    if (kind === "delete") {
      const result = await api.remove(page.path).catch((err) => {
        handleError(err, "삭제하지 못했습니다");
        throw err;
      });
      toast.success("비활성화했습니다", result.purgeAfter ? `${timeUntil(result.purgeAfter)} 완전 삭제` : undefined);
    } else {
      await api.restore(page.path).catch((err) => {
        handleError(err, "복원하지 못했습니다");
        throw err;
      });
      toast.success("복원했습니다", page.path);
    }
    await load();
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <TerminalIcon className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              page <span className="text-muted-foreground">/ admin</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs text-muted-foreground sm:inline-flex">
              <UserIcon className="size-3.5" />
              {auth!.id}
            </span>
            <Button variant="ghost" size="sm" onClick={logout} title="로그아웃">
              <LogoutIcon className="size-4" />
              <span className="hidden sm:inline">로그아웃</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">페이지</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loading
                ? "불러오는 중…"
                : `공개 ${activeCount}개${disabledCount ? ` · 비활성 ${disabledCount}개` : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading} title="새로고침">
              {loading ? <SpinnerIcon className="size-4" /> : <RefreshIcon className="size-4" />}
              <span className="hidden sm:inline">새로고침</span>
            </Button>
            <Button size="sm" onClick={openCreate}>
              <PlusIcon className="size-4" />새 페이지
            </Button>
          </div>
        </div>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <SpinnerIcon className="size-6" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                <RefreshIcon className="size-4" />
                다시 시도
              </Button>
            </div>
          ) : pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-secondary/50 text-muted-foreground">
                <PlusIcon className="size-6" />
              </div>
              <div>
                <p className="text-sm font-medium">아직 페이지가 없습니다</p>
                <p className="mt-1 text-sm text-muted-foreground">첫 HTML 페이지를 업로드해 보세요.</p>
              </div>
              <Button size="sm" onClick={openCreate}>
                <PlusIcon className="size-4" />새 페이지
              </Button>
            </div>
          ) : (
            <PagesTable
              pages={pages}
              onOpen={openRendered}
              onEdit={openEdit}
              onHistory={(page) => setHistory(page)}
              onDelete={(page) => setConfirm({ kind: "delete", page })}
              onRestore={(page) => setConfirm({ kind: "restore", page })}
            />
          )}
        </Card>
      </main>

      <PageEditorDialog
        open={editor.open}
        onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))}
        target={editor.target}
        api={api}
        onSaved={() => void load()}
      />

      <RevisionsDialog
        open={history !== null}
        onOpenChange={(open) => !open && setHistory(null)}
        page={history}
        api={api}
        onRolledBack={() => void load()}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === "delete" ? "페이지를 비활성화할까요?" : "페이지를 복원할까요?"}
        description={
          confirm?.kind === "delete" ? (
            <>
              <span className="font-medium text-foreground">{confirm.page.path}</span> 는 즉시 비공개(404)가 되고,
              약 1주일 뒤 리비전까지 완전히 삭제됩니다. 그 전까지는 복원할 수 있습니다.
            </>
          ) : confirm ? (
            <>
              <span className="font-medium text-foreground">{confirm.page.path}</span> 를 다시 공개하고 삭제 예약을
              취소합니다.
            </>
          ) : null
        }
        confirmLabel={confirm?.kind === "delete" ? "비활성화" : "복원"}
        variant={confirm?.kind === "delete" ? "destructive" : "default"}
        onConfirm={runConfirm}
      />
    </div>
  );
}
