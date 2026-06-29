import type { DependencyContainer } from "tsyringe";
import { HealthController } from "./health.controller";

export const HealthModule = {
  register(_container: DependencyContainer): void {},
  controllers: [HealthController],
};
