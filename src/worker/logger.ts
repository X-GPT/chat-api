import { pino } from "pino";
import { workerEnv } from "@/config/env";

export const logger = pino({
	level: workerEnv.LOG_LEVEL,
});
