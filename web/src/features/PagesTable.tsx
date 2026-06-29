import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { formatDateTime, shortSha, timeUntil } from "../lib/format";
import { ExternalIcon, PencilIcon, RestoreIcon, TrashIcon } from "../lib/icons";
import type { PageListItem } from "../lib/types";

type Props = {
  pages: PageListItem[];
  onOpen: (path: string) => void;
  onEdit: (path: string) => void;
  onDelete: (page: PageListItem) => void;
  onRestore: (page: PageListItem) => void;
};

export function PagesTable({ pages, onOpen, onEdit, onDelete, onRestore }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[34%]">경로</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="hidden md:table-cell">수정</TableHead>
          <TableHead className="hidden lg:table-cell">rev</TableHead>
          <TableHead className="hidden lg:table-cell">sha256</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page) => {
          const disabled = page.disabledAt !== null;
          return (
            <TableRow key={page.path} className="animate-in">
              <TableCell>
                <button
                  type="button"
                  onClick={() => onOpen(page.path)}
                  disabled={disabled}
                  className="group inline-flex max-w-full items-center gap-1.5 truncate font-medium text-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:text-muted-foreground"
                  title={disabled ? "비활성 페이지는 열 수 없습니다" : `${page.path} 열기`}
                >
                  <span className="truncate">{page.path}</span>
                  {!disabled && <ExternalIcon className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />}
                </button>
              </TableCell>
              <TableCell>
                {disabled ? (
                  <Badge variant="warning" title={page.purgeAfter ? formatDateTime(page.purgeAfter) : undefined}>
                    비활성 · {page.purgeAfter ? `${timeUntil(page.purgeAfter)} 삭제` : "삭제 예정"}
                  </Badge>
                ) : (
                  <Badge variant="success">공개</Badge>
                )}
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">
                {formatDateTime(page.updatedAt)}
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">#{page.revisionId}</TableCell>
              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{shortSha(page.contentSha256)}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => onEdit(page.path)} title="편집">
                    <PencilIcon className="size-4" />
                  </Button>
                  {disabled ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRestore(page)}
                      title="복원"
                      className="text-success hover:text-success"
                    >
                      <RestoreIcon className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(page)}
                      title="삭제"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
