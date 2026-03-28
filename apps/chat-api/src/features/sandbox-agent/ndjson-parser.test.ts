import { describe, expect, it } from "bun:test";
import { type AgentStreamEvent, createNdjsonParser } from "./ndjson-parser";

describe("createNdjsonParser", () => {
	it("parses text_delta events", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"type":"text_delta","text":"Hello"}\n');

		expect(events).toEqual([{ type: "text_delta", text: "Hello" }]);
	});

	it("parses result events", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"type":"result","text":"Full answer text"}\n');

		expect(events).toEqual([{ type: "result", text: "Full answer text" }]);
	});

	it("parses error events", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"type":"error","message":"Something went wrong"}\n');

		expect(events).toEqual([
			{ type: "error", message: "Something went wrong" },
		]);
	});

	it("handles multiple lines in one chunk", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed(
			'{"type":"text_delta","text":"A"}\n{"type":"text_delta","text":"B"}\n',
		);

		expect(events).toEqual([
			{ type: "text_delta", text: "A" },
			{ type: "text_delta", text: "B" },
		]);
	});

	it("buffers partial lines across chunks", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"type":"text_del');
		expect(events).toEqual([]);

		parser.feed('ta","text":"Hi"}\n');
		expect(events).toEqual([{ type: "text_delta", text: "Hi" }]);
	});

	it("flush processes remaining buffer", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"type":"result","text":"done"}');
		expect(events).toEqual([]);

		parser.flush();
		expect(events).toEqual([{ type: "result", text: "done" }]);
	});

	it("ignores empty lines", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('\n\n{"type":"text_delta","text":"X"}\n\n');

		expect(events).toEqual([{ type: "text_delta", text: "X" }]);
	});

	it("ignores non-JSON output", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed("npm warn something\n");
		parser.feed('{"type":"text_delta","text":"Y"}\n');

		expect(events).toEqual([{ type: "text_delta", text: "Y" }]);
	});

	it("ignores objects without a valid type", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"foo":"bar"}\n');
		parser.feed('{"type":123}\n');

		expect(events).toEqual([]);
	});

	it("ignores unknown event types", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"type":"tool_use","tool":"Grep","input":{}}\n');

		expect(events).toEqual([]);
	});

	it("ignores text_delta with non-string text", () => {
		const events: AgentStreamEvent[] = [];
		const parser = createNdjsonParser((e) => events.push(e));

		parser.feed('{"type":"text_delta","text":42}\n');

		expect(events).toEqual([]);
	});
});
