import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { useToast } from "../components/ui/toast";
import { useErrorToast } from "../hooks/useErrorToast";
import { ApiError, type Api } from "../lib/api";
import { byteLength, formatBytes } from "../lib/format";
import { FileIcon, SpinnerIcon, UploadIcon } from "../lib/icons";
import { validatePagePath } from "../lib/path";

const HTML_MAX_BYTES = 1_048_576;

export type EditorTarget = { mode: "create" } | { mode: "edit"; path: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: EditorTarget;
  api: Api;
  onSaved: () => void;
};

export function PageEditorDialog({ open, onOpenChange, target, api, onSaved }: Props) {
  const toast = useToast();
  const handleError = useErrorToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pathValue, setPathValue] = useState("");
  const [html, setHtml] = useState("");
  const [expectedSha, setExpectedSha] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("edit");

  useEffect(() => {
    if (!open) return;
    setTab("edit");
    setSaving(false);
    if (target.mode === "create") {
      setPathValue("");
      setHtml("");
      setExpectedSha(undefined);
      setLoading(false);
      return;
    }
    const path = target.path;
    setPathValue(path);
    setExpectedSha(undefined);
    setHtml("");
    setLoading(true);
    let cancelled = false;
    api
      .getSource(path)
      .then((src) => {
        if (cancelled) return;
        setHtml(src.html);
        setExpectedSha(src.contentSha256);
      })
      .catch((err) => {
        if (!cancelled) handleError(err, "원본을 불러오지 못했습니다");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // open/target 변경 시에만 초기화 (api·handleError는 세션 내 안정적).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target.mode, target.mode === "edit" ? target.path : ""]);

  const isEdit = target.mode === "edit";
  const targetPath = isEdit ? (target as { path: string }).path : pathValue.trim();
  const pathError = isEdit ? null : pathValue ? validatePagePath(pathValue) : null;
  const bytes = byteLength(html);
  const tooLarge = bytes > HTML_MAX_BYTES;
  const canSave =
    !saving && !loading && html.length > 0 && !tooLarge && (isEdit || validatePagePath(targetPath) === null);

  async function onPickFile(file: File) {
    try {
      const text = await file.text();
      setHtml(text);
      toast.info("파일을 불러왔습니다", file.name);
    } catch {
      toast.error("파일을 읽지 못했습니다", file.name);
    }
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.save({ path: targetPath, html, expectedContentSha256: isEdit ? expectedSha : undefined });
      toast.success(isEdit ? "페이지를 저장했습니다" : "페이지를 만들었습니다", targetPath);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") {
        if (isEdit) {
          toast.error("내용이 변경되었습니다", "최신본을 다시 불러왔습니다. 확인 후 다시 저장하세요.");
          try {
            const src = await api.getSource(targetPath);
            setHtml(src.html);
            setExpectedSha(src.contentSha256);
          } catch {
            /* 무시: 다음 저장에서 재시도 */
          }
        } else {
          toast.error("이미 존재하는 경로입니다", "편집 모드에서 수정하세요.");
        }
      } else {
        handleError(err, "저장하지 못했습니다");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex max-h-[88dvh] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-4" showClose={!saving}>
        <div className="flex flex-col gap-1 pr-6">
          <h2 className="text-base font-semibold tracking-tight">
            {isEdit ? "페이지 편집" : "새 페이지"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? "저장하면 새 리비전이 만들어지고, 비활성 상태였다면 다시 공개됩니다."
              : "경로에 HTML을 저장하면 누구나 해당 경로에서 볼 수 있습니다."}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="page-path">경로</Label>
          <Input
            id="page-path"
            value={pathValue}
            onChange={(e) => setPathValue(e.target.value)}
            placeholder="/demo"
            disabled={isEdit}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={pathError ? true : undefined}
            className={pathError ? "border-destructive/60" : undefined}
          />
          {pathError ? (
            <p className="text-xs text-destructive">{pathError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">소문자·숫자·_·- 세그먼트만 (예: /demo, /docs/intro)</p>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTab value="edit">HTML</TabsTab>
              <TabsTab value="preview">미리보기</TabsTab>
            </TabsList>
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPickFile(file);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={saving}>
              <FileIcon className="size-4" />
              HTML 파일 불러오기
            </Button>
          </div>

          <TabsPanel value="edit" className="min-h-0 flex-1">
            {loading ? (
              <div className="flex h-64 items-center justify-center text-muted-foreground">
                <SpinnerIcon className="size-5" />
              </div>
            ) : (
              <Textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                placeholder="<!doctype html>&#10;<h1>Hello</h1>"
                className="h-[46vh] font-mono text-xs"
              />
            )}
          </TabsPanel>

          <TabsPanel value="preview" className="min-h-0 flex-1">
            <div className="h-[46vh] overflow-hidden rounded-md border border-border bg-white">
              <iframe
                title="미리보기"
                sandbox="allow-scripts"
                srcDoc={html}
                className="size-full"
              />
            </div>
          </TabsPanel>
        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className={`text-xs ${tooLarge ? "text-destructive" : "text-muted-foreground"}`}>
            {formatBytes(bytes)} / 1 MB
          </span>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              취소
            </Button>
            <Button onClick={save} disabled={!canSave}>
              {saving ? <SpinnerIcon className="size-4" /> : <UploadIcon className="size-4" />}
              {isEdit ? "저장" : "업로드"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
