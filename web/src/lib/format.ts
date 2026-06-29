export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** iso 시각까지 남은 시간을 사람이 읽을 한국어로(예: "6일 후", "3시간 후", "곧"). 과거면 "지남". */
export function timeUntil(iso: string): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return iso;
  const diff = target - Date.now();
  if (diff <= 0) return "지남";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return minutes <= 1 ? "곧" : `${minutes}분 후`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}시간 후`;
  const days = Math.round(hours / 24);
  return `${days}일 후`;
}
