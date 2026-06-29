// 런타임 AppConfig 값을 DI 컨테이너에 등록하기 위한 토큰.
// createApp이 주입받은 config를 이 토큰으로 registerInstance하고, ConfigService가 @Inject한다.
export const APP_CONFIG = Symbol("APP_CONFIG");
