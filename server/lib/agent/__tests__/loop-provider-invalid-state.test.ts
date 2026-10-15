import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { AnthropicProviderConfig } from "../../settings";
import { AnthropicProvider } from "../anthropic-provider";
import type { ProviderAdapter, ReasoningProviderMetadata } from "../provider";
import type { AgentConfig, AgentEvent } from "../types";

const provider = new AnthropicProvider({
	id: "loop-invalid-state-anthropic",
	name: "Loop Invalid State Anthropic",
	prefix: "loop-invalid-state",
	apiKey: "test-key",
	baseUrl: "https://example.com/v1",
	defaultModel: "claude-test",
} satisfies AnthropicProviderConfig);

const realProviderModule = { ...(await import("../provider")) };

mock.module("../provider", () => ({
	...realProviderModule,
	getProvider: () => provider as ProviderAdapter,
	resolveProviderAndModel: (model = "loop-invalid-state:claude-test") => ({
		requestedProvider: "loop-invalid-state",
		requestedModel: model,
		provider: "loop-invalid-state",
		adapter: provider as ProviderAdapter,
		model,
	}),
}));

const { agentLoop } = await import("../loop");
const originalFetch = globalThis.fetch;

function responseFailed(
	message: string,
	options: { code?: string; statusCode?: number } = {},
): Response {
	const data = options.code
		? {
				type: "error",
				error: { type: options.code, message },
				diagnostics: { statusCode: options.statusCode },
			}
		: {
				type: "error",
				message,
				diagnostics: { statusCode: options.statusCode },
			};
	return new Response(`event: error\ndata: ${JSON.stringify(data)}\n\n`, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function structuredInvalidStateResponse(options: {
	reason: string;
	message: string;
	text?: string;
	reasoning?: string;
	signature?: string;
	limitEvent?: "error" | "stop_reason";
	completionTokens?: number;
}): Response {
	const events = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_limited","usage":{"input_tokens":3}}}\n\n',
	];
	if (options.reasoning != null || options.signature != null) {
		events.push(
			`event: content_block_start\ndata: ${JSON.stringify({
				type: "content_block_start",
				index: 0,
				content_block: { type: "thinking", thinking: options.reasoning ?? "" },
			})}\n\n`,
		);
		if (options.signature != null) {
			events.push(
				`event: content_block_delta\ndata: ${JSON.stringify({
					type: "content_block_delta",
					index: 0,
					delta: { type: "signature_delta", signature: options.signature },
				})}\n\n`,
			);
		}
		events.push('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
	}
	if (options.text) {
		events.push(
			'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
			`event: content_block_delta\ndata: ${JSON.stringify({
				type: "content_block_delta",
				index: 1,
				delta: { type: "text_delta", text: options.text },
			})}\n\n`,
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
		);
	}
	if (options.limitEvent !== "stop_reason") {
		events.push(
			`event: error\ndata: ${JSON.stringify({
				type: "error",
				error: { type: options.reason, message: options.message },
			})}\n\n`,
		);
	}
	events.push(
		`event: message_delta\ndata: ${JSON.stringify({
			type: "message_delta",
			delta: {
				stop_reason: options.limitEvent === "stop_reason" ? options.reason : "end_turn",
			},
			usage: { output_tokens: options.completionTokens ?? 7 },
		})}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	);
	return new Response(events.join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function successfulResponse(text: string): Response {
	return new Response(
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_recovered","usage":{"input_tokens":1}}}\n\n' +
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
			`event: content_block_delta\ndata: ${JSON.stringify({
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text },
			})}\n\n` +
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		{ status: 200, headers: { "content-type": "text/event-stream" } },
	);
}

function installResponses(responses: Response[]): () => number {
	let calls = 0;
	globalThis.fetch = (async () => {
		const response = responses[calls++];
		if (!response) throw new Error(`Unexpected fetch call ${calls}`);
		return response;
	}) as unknown as typeof fetch;
	return () => calls;
}

function makeConfig(signal: AbortSignal, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		narratorId: "n-loop-invalid-state",
		conversationId: "conv-loop-invalid-state",
		model: "loop-invalid-state:claude-test",
		provider: "loop-invalid-state",
		cwd: "/tmp",
		signal,
		permissionHandler: async () => ({ behavior: "allow" }),
		toolFilter: () => false,
		maxTransientRetries: 1,
		retryBackoffCeilMs: 0,
		...overrides,
	};
}

async function runLoop(overrides: Partial<AgentConfig> = {}): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	const controller = new AbortController();
	for await (const event of agentLoop(makeConfig(controller.signal, overrides), "answer", [])) {
		events.push(event);
	}
	return events;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

afterAll(() => {
	globalThis.fetch = originalFetch;
	mock.module("../provider", () => realProviderModule);
	mock.restore();
});

describe("agentLoop provider invalidState classification", () => {
	test("HTTP 200 SSE api_error 会按 diagnostics.statusCode=503 重试", async () => {
		const fetchCalls = installResponses([
			responseFailed("Opaque upstream failure", { statusCode: 503 }),
			successfulResponse("recovered"),
		]);

		const events = await runLoop();

		expect(fetchCalls()).toBe(2);
		expect(events.find((event) => event.type === "retrying")).toMatchObject({
			type: "retrying",
			message: "Opaque upstream failure",
			diagnostics: { reason: "api_error", statusCode: 503 },
		});
		expect(events.find((event) => event.type === "stream_text")).toMatchObject({
			type: "stream_text",
			text: "recovered",
		});
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("503 的 unable to respond 文本不会被宽泛拒绝启发式拦截", async () => {
		const fetchCalls = installResponses([
			responseFailed("Service temporarily unable to respond", { statusCode: 503 }),
			successfulResponse("recovered after 503"),
		]);

		const events = await runLoop();

		expect(fetchCalls()).toBe(2);
		expect(events.find((event) => event.type === "retrying")).toMatchObject({
			type: "retrying",
			message: "Service temporarily unable to respond",
			diagnostics: { reason: "api_error", statusCode: 503 },
		});
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("结构化 refusal 即使携带 503 也保持不可重试", async () => {
		const fetchCalls = installResponses([
			responseFailed("I cannot assist with that request", {
				code: "refusal",
				statusCode: 503,
			}),
		]);

		const events = await runLoop();

		expect(fetchCalls()).toBe(1);
		expect(events.some((event) => event.type === "retrying")).toBe(false);
		expect(events.at(-1)).toMatchObject({
			type: "invalid_state",
			reason: "refusal",
			message: "I cannot assist with that request",
			diagnostics: { statusCode: 503 },
		});
		const end = events.find((event) => event.type === "api_request_end");
		const terminal = events.at(-1);
		if (!end || terminal?.type !== "invalid_state") throw new Error("missing error events");
		expect(terminal.diagnostics).toBe(end.diagnostics);
		expect(terminal.diagnostics?.recordingRequestId).toBe(end.requestId);
		if (!end.diagnostics) throw new Error("missing diagnostics");
		end.diagnostics.apiRequestId = "refusal-durable-row";
		expect(terminal.diagnostics?.apiRequestId).toBe("refusal-durable-row");
	});

	test("max_tokens 含部分文本时保留截断终态并继续消费 usage", async () => {
		const message = "The response exceeds the maximum number of tokens allowed.";
		const fetchCalls = installResponses([
			structuredInvalidStateResponse({
				reason: "max_tokens",
				message,
				text: "partial answer",
				completionTokens: 17,
			}),
		]);

		const events = await runLoop();
		const requestEnd = events.find(
			(event): event is Extract<AgentEvent, { type: "api_request_end" }> =>
				event.type === "api_request_end",
		);

		expect(fetchCalls()).toBe(1);
		expect(events.filter((event) => event.type === "output_truncated")).toHaveLength(1);
		expect(events.some((event) => event.type === "context_length_exceeded")).toBe(false);
		expect(events.some((event) => event.type === "retrying")).toBe(false);
		expect(requestEnd?.usage?.completionTokens).toBe(17);
		expect(
			events.some((event) => event.type === "assistant_message" && event.text === "partial answer"),
		).toBe(true);
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("max_tokens 且完全无产出时不再续跑，改为报出上游异常", async () => {
		const fetchCalls = installResponses([
			structuredInvalidStateResponse({
				reason: "max_tokens",
				message: "The response exceeds the maximum number of tokens allowed.",
				completionTokens: 11,
			}),
		]);

		const events = await runLoop();
		const requestEnd = events.find(
			(event): event is Extract<AgentEvent, { type: "api_request_end" }> =>
				event.type === "api_request_end",
		);
		const last = events.at(-1);

		expect(fetchCalls()).toBe(1);
		// 这一轮没产出任何可续接的内容，续跑只会把同一份预算再烧一遍，所以必须终结。
		expect(events.some((event) => event.type === "output_truncated")).toBe(false);
		expect(events.some((event) => event.type === "retrying")).toBe(false);
		expect(events.some((event) => event.type === "invalid_state")).toBe(false);
		expect(requestEnd?.usage?.completionTokens).toBe(11);
		expect(last).toMatchObject({ type: "error" });
		expect(last?.type === "error" ? last.message : "").toContain(
			"The response exceeds the maximum number of tokens allowed.",
		);
	});

	for (const limitEvent of ["error", "stop_reason"] as const) {
		for (const reasoning of ["", " \n\t"]) {
			test(`max_tokens ${limitEvent} 仅含签名和${reasoning ? "空白" : "空"}推理时终止且保留 usage`, async () => {
				let compactCalls = 0;
				const fetchCalls = installResponses([
					structuredInvalidStateResponse({
						reason: "max_tokens",
						message: "Response reached the output limit.",
						reasoning,
						signature: "opaque-signature",
						limitEvent,
						completionTokens: 64_000,
					}),
				]);

				const events = await runLoop({
					getContextUsagePercentage: () => 96,
					onReasoningOnlyHighContext: async () => {
						compactCalls++;
						return null;
					},
				});
				const requestEnds = events.filter(
					(event): event is Extract<AgentEvent, { type: "api_request_end" }> =>
						event.type === "api_request_end",
				);

				expect(fetchCalls()).toBe(1);
				expect(events.some((event) => event.type === "output_truncated")).toBe(false);
				expect(events.some((event) => event.type === "retrying")).toBe(false);
				expect(events.some((event) => event.type === "stream_reset")).toBe(false);
				expect(compactCalls).toBe(0);
				expect(requestEnds).toHaveLength(1);
				expect(requestEnds[0]?.usage?.completionTokens).toBe(64_000);
				expect(events.at(-1)).toMatchObject({ type: "error" });
			});
		}
	}

	test("新Claude省略展示思考的合法签名仍可续接，不误报空产出", async () => {
		const fetchCalls = installResponses([
			structuredInvalidStateResponse({
				reason: "max_tokens",
				message: "limit",
				signature: "opaque-state",
				limitEvent: "stop_reason",
				completionTokens: 64_000,
			}),
		]);
		const events = await runLoop({ model: "loop-invalid-state:claude-haiku-5-5" });
		expect(fetchCalls()).toBe(1);
		expect(events.filter((event) => event.type === "output_truncated")).toHaveLength(1);
		expect(events.some((event) => event.type === "error")).toBe(false);
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("max_tokens 含签名和正文时仍保留截断续跑", async () => {
		const fetchCalls = installResponses([
			structuredInvalidStateResponse({
				reason: "max_tokens",
				message: "Response reached the output limit.",
				signature: "opaque-signature",
				text: "partial answer",
				limitEvent: "stop_reason",
				completionTokens: 17,
			}),
		]);

		const events = await runLoop();

		expect(fetchCalls()).toBe(1);
		expect(events.filter((event) => event.type === "output_truncated")).toHaveLength(1);
		expect(events.some((event) => event.type === "retrying")).toBe(false);
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("max_tokens 仅含 reasoning 时不触发 reasoning-only compact 或重试", async () => {
		let compactCalls = 0;
		const fetchCalls = installResponses([
			structuredInvalidStateResponse({
				reason: "max_tokens",
				message: "The response exceeds the maximum number of tokens allowed.",
				reasoning: "unfinished reasoning",
			}),
		]);

		const events = await runLoop({
			getContextUsagePercentage: () => 96,
			onReasoningOnlyHighContext: async () => {
				compactCalls++;
				return null;
			},
		});

		expect(fetchCalls()).toBe(1);
		expect(compactCalls).toBe(0);
		expect(events.filter((event) => event.type === "output_truncated")).toHaveLength(1);
		expect(events.some((event) => event.type === "stream_reset")).toBe(false);
		expect(events.some((event) => event.type === "retrying")).toBe(false);
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	const metadataCases: Array<{
		name: string;
		metadata: ReasoningProviderMetadata;
		canContinue: boolean;
	}> = [
		{ name: "Anthropic 块序号", metadata: { anthropic: { blockIndex: 0 } }, canContinue: false },
		{ name: "OpenAI 条目 ID", metadata: { openai: { itemId: "rs_empty" } }, canContinue: false },
		{
			name: "Gemini 步骤 ID",
			metadata: { gemini: { stepId: "thought_empty" } },
			canContinue: false,
		},
		{
			name: "OpenAI 空白加密内容",
			metadata: { openai: { reasoningEncryptedContent: " \n\t" } },
			canContinue: false,
		},
		{
			name: "OpenAI 有效加密内容",
			metadata: {
				openai: { itemId: "rs_valid", reasoningEncryptedContent: "encrypted-reasoning" },
			},
			canContinue: true,
		},
		{
			name: "Gemini 有效 thought signature",
			metadata: { gemini: { thoughtSignature: "opaque-thought-state" } },
			canContinue: true,
		},
	];
	for (const { name, metadata, canContinue } of metadataCases) {
		test(`max_tokens 无推理文字时，${name}${canContinue ? "仍可续接" : "不能驱动续跑"}`, async () => {
			const chat = spyOn(provider, "chat").mockImplementation(async function* (params) {
				await params.onRequestStart?.();
				yield { reasoningMetadata: metadata };
				yield {
					invalidState: { reason: "max_tokens", message: "Response reached the output limit." },
				};
				yield { usage: { promptTokens: 3, completionTokens: 11 } };
			});
			try {
				const events = await runLoop();
				const requestEnds = events.filter(
					(event): event is Extract<AgentEvent, { type: "api_request_end" }> =>
						event.type === "api_request_end",
				);

				expect(chat).toHaveBeenCalledTimes(1);
				expect(events.some((event) => event.type === "output_truncated")).toBe(canContinue);
				expect(events.some((event) => event.type === "retrying")).toBe(false);
				expect(requestEnds).toHaveLength(1);
				expect(requestEnds[0]?.usage?.completionTokens).toBe(11);
				expect(events.at(-1)).toMatchObject({ type: canContinue ? "done" : "error" });
			} finally {
				chat.mockRestore();
			}
		});
	}

	test("真正的 context overflow 仍进入 context_length_exceeded", async () => {
		const message = "The input token count exceeds the maximum number of tokens allowed.";
		const fetchCalls = installResponses([
			structuredInvalidStateResponse({
				reason: "model_context_window_exceeded",
				message,
			}),
		]);

		const events = await runLoop();

		expect(fetchCalls()).toBe(1);
		expect(events.some((event) => event.type === "output_truncated")).toBe(false);
		expect(events.some((event) => event.type === "retrying")).toBe(false);
		expect(events.at(-1)).toEqual({ type: "context_length_exceeded", message });
	});
});
