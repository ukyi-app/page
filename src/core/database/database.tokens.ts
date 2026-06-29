// 런타임 Postgres Pool을 DI 컨테이너에 등록하기 위한 토큰.
// DatabaseModule이 ConfigService 기반 factory로 제공하고, PageRepository가 @Inject한다.
export const PG_POOL = Symbol("PG_POOL");
