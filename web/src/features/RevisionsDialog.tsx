import { useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useToast } from "../components/ui/toast";
import { useErrorToast } from "../hooks/useErrorToast";
import { ApiError, type Api } from "../lib/api";
import { formatDateTime, shortSha } from "../lib/format";
import { RestoreIcon, SpinnerIcon } from "../lib/icons";
import type { PageListItem, PageMetadata } from "../lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: PageListItem | null;
  api: Api;
  onRolledBack: () => void;
};

export function RevisionsDialog({ open, onOpenChange, page, api, onRolledBack }: Props) {
  const toast = useToast();
  const handleError = useErrorToast();
  const [revisions, setRevisions] = useState<PageMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // 낙관적 락용 현재 sha. 롤백 성공/충돌 후 최신값으로 갱신.
  const [currentSha, setCurrentSha] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !page) return;
    setRevisions([]);
    setBusyId(null);
    setCurrentSha(page.contentSha256);
    setLoading(true);
    let cancelled = false;
    api
      .listRevisions(page.path)
      .then((r) => !cancelled && setRevisions(r))
      .catch((err) => !cancelled && handleError(err, "리비전을 불러오지 못했습니다"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page?.path]);

  async function rollback(rev: PageMetadata) {
    if (!page || busyId !== null || !currentSha) return;
    setBusyId(rev.revisionId);
    try {
      const result = await api.rollback({ path: page.path, revisionId: rev.revisionId, expectedContentSha256: currentSha });
      toast.success("롤백했습니다", `${page.path} → rev #${rev.revisionId}`);
      setCurrentSha(result.contentSha256);
      onRolledBack();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") {
        toast.error("내용이 변경되었습니다", "최신 상태를 다시 불러왔습니다.");
        try {
          setRevisions(await api.listRevisions(page.path));
          if (err.body?.current?.contentSha256) setCurrentSha(err.body.current.contentSha256);
        } catch {
          /* 무시 */
        }
      } else {
        handleError(err, "롤백하지 못했습니다");
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => busyId === null && onOpenChange(next)}>
      <DialogContent className="max-w-2xl" showClose={busyId === null}>
        <DialogHeader>
          <DialogTitle>리비전 히스토리</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{page?.path}</span> 의 최근 리비전(최신순, 최대 20개). 이전
            리비전으로 롤백하면 현재 포인터만 옮기고 히스토리는 보존됩니다.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <SpinnerIcon className="size-5" />
          </div>
        ) : revisions.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">리비전이 없습니다.</p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>rev</TableHead>
                  <TableHead>sha256</TableHead>
                  <TableHead className="hidden sm:table-cell">타입</TableHead>
                  <TableHead className="hidden sm:table-cell">생성</TableHead>
                  <TableHead className="text-right">작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.map((rev) => {
                  const isCurrent = rev.contentSha256 === currentSha;
                  return (
                    <TableRow key={rev.revisionId}>
                      <TableCell className="font-medium">#{rev.revisionId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{shortSha(rev.contentSha256)}</TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{rev.contentType}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                        {formatDateTime(rev.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isCurrent ? (
                          <Badge variant="success">현재</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => rollback(rev)}
                            disabled={busyId !== null}
                            className="text-muted-foreground hover:text-primary"
                          >
                            {busyId === rev.revisionId ? <SpinnerIcon className="size-4" /> : <RestoreIcon className="size-4" />}
                            롤백
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
