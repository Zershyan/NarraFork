import { afterEach, expect, test } from "bun:test";
import { AnthropicProvider } from "../anthropic-provider";
import type { ChatParams, DbMessage } from "../provider";
import type { ContentBlock } from "../types";

const originalFetch = globalThis.fetch;
const signature = "opaque-thinking-state";
const reminderText = "例行任务摘要，不是用户新请求";
const model = "claude-haiku-5-5";

function provider(): AnthropicProvider {
	return new AnthropicProvider({
		id: "passive",
		prefix: "passive",
		name: "Passive",
		apiKey: "test-key",
		baseUrl: "https://example.invalid/v1",
		defaultModel: model,
	});
}

type WireBlock = {
	type: string;
	thinking?: string;
	signature?: string;
	text?: string;
	content?: string;
	tool_use_id?: string;
};
type WireMessage = { role: string; content: WireBlock[] };

async function capture(
	adapter: AnthropicProvider,
	overrides: Partial<ChatParams>,
): Promise<WireMessage[]> {
	let messages: WireMessage[] = [];
	globalThis.fetch = (async (_input, init) => {
		messages = JSON.parse(String(init?.body)).messages as WireMessage[];
		return new Response(
			'data: {"type":"message_start","message":{"id":"probe"}}\n\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}}\n\ndata: {"type":"content_block_stop","index":0}\n\ndata: {"type":"message_stop"}\n\n',
			{ headers: { "content-type": "text/event-stream" } },
		);
	}) as typeof fetch;
	for await (const _ of adapter.chat({
		conversationId: "passive-test",
		model,
		cwd: process.cwd(),
		content: "",
		history: [],
		tools: [],
		toolResults: [],
		reasoningEffort: "max",
		signal: new AbortController().signal,
		...overrides,
	})) {
	}
	return messages;
}

function rows(source = "living_work_spec", role: "sys" | "user" = "sys"): DbMessage[] {
	return [
		{
			id: "user",
			role: "user",
			contentJson: [{ type: "text", text: "修改界面" }],
			contentText: "修改界面",
			parentToolUseId: null,
			messageUuid: null,
		},
		{
			id: "assistant",
			role: "assistant",
			contentText: "读取文件",
			parentToolUseId: null,
			messageUuid: null,
			contentJson: [
				{
					type: "reasoning",
					text: "",
					providerMetadata: { anthropic: { signature }, signatureSource: "passive" },
				},
				{ type: "text", text: "读取文件" },
				{ type: "tool_use", id: "tool_1", name: "Read", input: {} },
			],
			toolCalls: [
				{
					toolUseId: "tool_1",
					toolName: "Read",
					inputJson: {},
					outputJson: "文件内容",
					status: "success",
				},
			],
		},
		{
			id: "reminder",
			role,
			contentText: reminderText,
			parentToolUseId: null,
			messageUuid: null,
			contentJson: [
				{
					type: "system_injection",
					source,
					modelText: reminderText,
					body: { kind: "tasks", variant: "current", cadenceInterval: 15, tasks: [] },
				},
			],
		},
	];
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

for (const ordered of [false, true]) {
	test(`实时工具续接保留省略展示思考并将摘要放入工具结果：ordered=${ordered}`, async () => {
		const adapter = provider();
		const history: unknown[] = [{ role: "user", content: "修改界面" }];
		const reasoning = { text: "", providerMetadata: { anthropic: { signature } } };
		const use = { toolUseId: "tool_1", name: "Read", input: {} };
		const orderedContent: ContentBlock[] = [
			{ type: "reasoning", ...reasoning },
			{ type: "text", text: "读取文件" },
			{ type: "tool_use", ...use },
		];
		adapter.pushAssistantTurn(
			history,
			"读取文件",
			[use],
			[reasoning],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			ordered ? orderedContent : undefined,
		);
		const results = [adapter.formatToolResult("tool_1", "文件内容", false)];
		expect(adapter.appendToolResultContext(results, reminderText)).toBe(true);
		const wire = await capture(adapter, { history, toolResults: results });
		expect(wire.at(-1)?.content.map((block) => block.type)).toEqual(["tool_result"]);
		expect(wire.at(-1)?.content[0]?.content).toContain(reminderText);
		expect(wire.find((message) => message.role === "assistant")?.content[0]).toEqual({
			type: "thinking",
			thinking: "",
			signature,
		});
	});
}

test("冷历史重建与实时请求一致，摘要只出现一次，原始消息不被修改", async () => {
	const adapter = provider();
	const input = rows();
	const snapshot = structuredClone(input);
	const built = await adapter.buildHistory(input, model);
	const wire = await capture(adapter, {
		history: built.history,
		toolResults: built.trailingToolResults,
	});
	expect(built.trailingUserText).toBeUndefined();
	expect(wire.at(-1)?.content.map((block) => block.type)).toEqual(["tool_result"]);
	expect(wire.at(-1)?.content[0]?.content?.split(reminderText)).toHaveLength(2);
	expect(wire.find((message) => message.role === "assistant")?.content[0]).toEqual({
		type: "thinking",
		thinking: "",
		signature,
	});
	expect(input).toEqual(snapshot);
});

test("真实用户的任务编辑仍保留为独立指令", async () => {
	const adapter = provider();
	const built = await adapter.buildHistory(rows("spec_update"), model);
	expect(built.trailingUserText).toContain(reminderText);
	const wire = await capture(adapter, {
		history: built.history,
		toolResults: built.trailingToolResults,
		content: built.trailingUserText,
	});
	expect(wire.at(-1)?.content.map((block) => block.type)).toEqual(["tool_result", "text"]);
});

for (const [name, thinking, sig] of [
	["旧模型", "", signature],
	["无签名", "", ""],
	["纯空白", " \n", signature],
] as const) {
	test(`非法空思考仍被清理：${name}`, async () => {
		const wire = await capture(provider(), {
			model: name === "旧模型" ? "claude-sonnet-4-6" : model,
			history: [
				{ role: "user", content: "task" },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking, signature: sig },
						{ type: "text", text: "answer" },
					],
				},
			],
			content: "继续",
		});
		expect(
			wire.flatMap((message) => message.content).some((block) => block.type === "thinking"),
		).toBe(false);
	});
}

test("跨提供商的省略展示签名不可重放", async () => {
	const adapter = provider();
	const input = rows();
	const block = (
		input[1].contentJson as Array<{ providerMetadata?: { signatureSource?: string } }>
	)[0];
	if (block.providerMetadata) block.providerMetadata.signatureSource = "other-provider";
	const built = await adapter.buildHistory(input, model);
	const wire = await capture(adapter, {
		history: built.history,
		toolResults: built.trailingToolResults,
	});
	expect(
		wire.flatMap((message) => message.content).some((block) => block.type === "thinking"),
	).toBe(false);
});
