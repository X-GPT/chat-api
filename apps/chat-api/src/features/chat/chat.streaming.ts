import type { SSEStreamingApi } from "hono/streaming";
import type { MymemoEvent } from "./chat.events";

export interface Sender<T> {
	send(data: T): Promise<void>;
}

export interface MymemoEventSender extends Sender<MymemoEvent> {}

export class HonoSSESender implements MymemoEventSender {
	constructor(private stream: SSEStreamingApi) {}

	async send(data: MymemoEvent) {
		await this.stream.writeSSE({
			data: JSON.stringify(data.message),
			event: data.message.type,
			id: data.id,
		});
	}
}
