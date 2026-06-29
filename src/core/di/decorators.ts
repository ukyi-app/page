import "reflect-metadata";
import { inject, injectable } from "tsyringe";

// 앱 코드가 tsyringe 데코레이터를 직접 쓰지 않도록 감싸는 유일한 경계 지점.
// 이 파일과 core/di/module.ts, app.module.ts(createApp), router.factory.ts만 tsyringe를 안다.

// biome-ignore lint: 데코레이터 타깃/토큰 타입
type Ctor = Function;
type InjectionToken = Parameters<typeof inject>[0];

/** tsyringe injectable을 적용해 클래스를 컨테이너 resolve 가능하게 만든다. @Controller가 재사용. */
export function applyInjectable(target: Ctor): void {
  // biome-ignore lint: tsyringe injectable 타깃 타입
  injectable()(target as any);
}

/** 범용 provider(가드 등). tsyringe injectable처럼 작동. */
export function Injectable(): ClassDecorator {
  return (target) => {
    applyInjectable(target);
  };
}

/** 서비스용 데코레이터. @Injectable 별칭(의미 구분). */
export const Service = Injectable;

/** 토큰 기반 생성자 파라미터 주입. tsyringe inject 래핑. */
export function Inject(token: InjectionToken): ParameterDecorator {
  return inject(token) as ParameterDecorator;
}
