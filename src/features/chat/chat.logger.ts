export class ChatLogger {
	constructor(
		private memberCode: string,
		private chatKey: string,
	) {}

	info(message: Record<string, unknown>) {
		console.log({
			memberCode: this.memberCode,
			chatKey: this.chatKey,
			...message,
		});
	}

	error(message: Record<string, unknown>) {
		console.error({
			memberCode: this.memberCode,
			chatKey: this.chatKey,
			...message,
		});
	}
}
