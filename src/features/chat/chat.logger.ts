import type { PinoLogger } from "hono-pino";

export class ChatLogger {
	constructor(
		private logger: PinoLogger,
		private memberCode: string,
		private chatKey: string,
	) {}

	info(message: Record<string, unknown>) {
		this.logger.info({
			memberCode: this.memberCode,
			chatKey: this.chatKey,
			...message,
		});
	}

	error(message: Record<string, unknown>) {
		this.logger.error({
			memberCode: this.memberCode,
			chatKey: this.chatKey,
			...message,
		});
	}
}
