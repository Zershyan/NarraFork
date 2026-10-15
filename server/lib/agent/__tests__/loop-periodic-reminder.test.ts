import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { z } from "zod/v4";
import { AnthropicProvider } from "../anthropic-provider";
import { toolRegistry } from "../tool-registry";
import type { AgentConfig, AgentEvent } from "../types";

const toolName = "TaskDigestProbe";
const model = "periodic:claude-haiku-5-5";
const adapter = new AnthropicProvider({
	id: "periodic",
	name: "Periodic",
	prefix: "periodic",
	apiKey: "test-key",
	baseUrl: "https://example.invalid/v1",
	defaultModel: "claude-haiku-5-5",
});
const realProviderModule = { ...(await import("../provider")) };
mock.module("../provider", () => ({
	...realProviderModule,
	getProvider: () => adapter,
	resolveProviderAndModel: () => ({
		requestedProvider: "periodic",
		requestedModel: model,
		provider: "periodic",
		model,
		adapter,
	}),
}));
const { agentLoop } = await import("../loop");
const originalFetch = globalThis.fetch;
let executions = 0;
toolRegistry.register({
	name: toolName,
	description: "测试任务摘要边界",
	parameters: z.object({}),
	execute: async () => {
		executions++;
		return { output: "工具真实结果" };
	},
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});
afterAll(() => {
	toolRegistry.unregister(toolName);
	mock.module("../provider", () => realProviderModule);
	mock.restore();
});

function response(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		headers: { "content-type": "text/event-stream" },
	});
}

async function run(text = "", supportsContext = true) {
	executions = 0;
	let count = 14;
	let delivered = false;
	const requests: Array<{
		messages: Array<{
			role: string;
			content: Array<{ type: string; text?: string; content?: string }>;
		}>;
	}> = [];
	globalThis.fetch = (async (_input, init) => {
		requests.push(JSON.parse(String(init?.body)));
		if (requests.length > 2) throw new Error("摘要触发了额外请求");
		return response(
			requests.length === 1
				? [
						{ type: "message_start", message: { id: "first", usage: { input_tokens: 1 } } },
						{
							type: "content_block_start",
							index: 0,
							content_block: { type: "thinking", thinking: "" },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "signature_delta", signature: "thinking-state" },
						},
						{ type: "content_block_stop", index: 0 },
						{
							type: "content_block_start",
							index: 1,
							content_block: { type: "tool_use", id: "tool_1", name: toolName, input: {} },
						},
						{ type: "content_block_stop", index: 1 },
						{
							type: "message_delta",
							delta: { stop_reason: "tool_use" },
							usage: { output_tokens: 1 },
						},
						{ type: "message_stop" },
					]
				: [
						{ type: "message_start", message: { id: "second", usage: { input_tokens: 1 } } },
						{
							type: "content_block_start",
							index: 0,
							content_block: { type: "text", text: "完成" },
						},
						{ type: "content_block_stop", index: 0 },
						{
							type: "message_delta",
							delta: { stop_reason: "end_turn" },
							usage: { output_tokens: 1 },
						},
						{ type: "message_stop" },
					],
		);
	}) as typeof fetch;
	const unsupported = supportsContext
		? undefined
		: spyOn(adapter, "appendToolResultContext").mockReturnValue(false);
	try {
		const config: AgentConfig = {
			narratorId: "n-periodic-reminder",
			conversationId: "conv-periodic-reminder",
			provider: "periodic",
			model,
			cwd: process.cwd(),
			signal: new AbortController().signal,
			permissionHandler: async () => ({ behavior: "allow" }),
			toolFilter: (tool) => tool.name === toolName,
			maxTurns: 3,
			initialCompletedToolCount: count,
			onCompletedToolCount: (value) => {
				count = value;
			},
			getAfterToolsInjections: () => {
				if (count < 15 || delivered) return "";
				delivered = true;
				return { text, toolResultContext: "每15次工具调用的任务摘要" };
			},
		};
		const events: AgentEvent[] = [];
		for await (const event of agentLoop(config, "执行任务", [])) events.push(event);
		return { requests, events, count };
	} finally {
		unsupported?.mockRestore();
	}
}

test("第15次工具完成后的摘要沿用工具结果，未新增用户指令或多余请求", async () => {
	const { requests, events, count } = await run();
	expect(executions).toBe(1);
	expect(count).toBe(15);
	expect(requests).toHaveLength(2);
	const content = requests[1]?.messages.at(-1)?.content;
	expect(content?.map((block) => block.type)).toEqual(["tool_result"]);
	expect(content?.[0]?.content).toContain("工具真实结果");
	expect(content?.[0]?.content).toContain("每15次工具调用的任务摘要");
	expect(events.filter((event) => event.type === "reasoning_status")).toEqual([
		{ type: "reasoning_status", active: true },
		{ type: "reasoning_status", active: false },
	]);
	expect(events.some((event) => event.type === "stream_reasoning")).toBe(false);
	expect(events.at(-1)).toEqual({ type: "done" });
});

test("摘要与真正用户指令同时到达时，用户指令仍保持独立 text", async () => {
	const { requests } = await run("用户要求调整任务方向");
	const content = requests[1]?.messages.at(-1)?.content;
	expect(content?.map((block) => block.type)).toEqual(["tool_result", "text"]);
	expect(content?.[0]?.content).toContain("每15次工具调用的任务摘要");
	expect(content?.[1]?.text).toBe("用户要求调整任务方向");
});

test("其他协议不支持被动工具上下文时回退成文本，摘要不会丢失", async () => {
	const { requests } = await run("", false);
	const content = requests[1]?.messages.at(-1)?.content;
	expect(content?.map((block) => block.type)).toEqual(["tool_result", "text"]);
	expect(content?.[1]?.text).toContain("每15次工具调用的任务摘要");
});
