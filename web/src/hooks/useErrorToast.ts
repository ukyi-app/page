import { ApiError } from "../lib/api";
import { describeApiError } from "../lib/errors";
import { useToast } from "../components/ui/toast";
import { useAuth } from "./useAuth";

/** API 오류를 토스트로 알리고, 401이면 자동 로그아웃한다. */
export function useErrorToast() {
  const toast = useToast();
  const { logout } = useAuth();
  return (err: unknown, fallback = "요청을 처리하지 못했습니다") => {
    if (err instanceof ApiError && err.isUnauthorized) {
      toast.error("인증이 만료되었습니다", "토큰으로 다시 로그인하세요.");
      logout();
      return;
    }
    toast.error(fallback, describeApiError(err));
  };
}
