import { expect, test } from "bun:test";
import {
	appendAnthropicToolResultContext,
	foldPeriodicSpecReminders,
} from "../passive-tool-context";
import type { DbMessage } from "../provider";

function assistant(): DbMessage {
	return {
		id: "assistant",
		role: "assistant",
		contentJson: [{ type: "tool_use", id: "tool_1", name: "Read", input: {} }],
		contentText: "读取文件",
		parentToolUseId: null,
		messageUuid: null,
		toolCalls: [
			{
				toolUseId: "tool_1",
				toolName: "Read",
				inputJson: {},
				outputJson: "文件内容",
				status: "success",
			},
		],
	};
}

function reminder(role: "sys" | "user" = "sys", source = "living_work_spec"): DbMessage {
	return {
		id: "reminder",
		role,
		contentJson: [
			{
				type: "system_injection",
				source,
				modelText: "定期任务摘要",
				body: { kind: "tasks", variant: "current", cadenceInterval: 15, tasks: [] },
			},
		],
		contentText: "定期任务摘要",
		parentToolUseId: null,
		messageUuid: null,
	};
}

test("实时提醒保留工具ID、错误标记和图片且不改动原始结果对象", () => {
	const original = {
		tool_use_id: "tool_1",
		content: [{ type: "image", source: "image-data" }],
		is_error: true,
	};
	const results: unknown[] = [original];
	expect(appendAnthropicToolResultContext(results, "任务摘要")).toBe(true);
	expect(results[0]).toEqual({
		...original,
		content: [
			...original.content,
			{ type: "text", text: "<system-reminder>\n任务摘要\n</system-reminder>" },
		],
	});
	expect(original.content).toHaveLength(1);
});

test("没有工具结果或协议不支持时明确回退，不吞掉摘要", () => {
	expect(appendAnthropicToolResultContext([], "任务摘要")).toBe(false);
	expect(
		appendAnthropicToolResultContext([{ toolUseId: "other", output: "result" }], "任务摘要"),
	).toBe(false);
});

test("历史中的定期摘要折叠到最后的工具结果，原消息与工具输出保持不变", () => {
	const input = [assistant(), reminder()];
	const snapshot = structuredClone(input);
	const folded = foldPeriodicSpecReminders(input);
	expect(folded).toHaveLength(1);
	expect(folded[0]?.toolCalls?.[0]?.outputJson).toContain("定期任务摘要");
	expect(folded[0]?.toolCalls?.[0]?.outputJson).toContain('kind="system"');
	expect(folded[0]?.toolCalls?.[0]?.toolUseId).toBe("tool_1");
	expect(input).toEqual(snapshot);
});

for (const [role, source] of [
	["user", "living_work_spec"],
	["sys", "spec_update"],
	["sys", "bg_agent"],
] as const) {
	test(`真实用户或其他注入不折叠：${role}/${source}`, () => {
		const input = [assistant(), reminder(role, source)];
		expect(foldPeriodicSpecReminders(input)).toEqual(input);
	});
}

test("没有可续接工具或没有周期标记时保留原来的独立提醒", () => {
	const noTools = assistant();
	noTools.toolCalls = [];
	expect(foldPeriodicSpecReminders([noTools, reminder()])).toHaveLength(2);
	const unmarked = reminder();
	unmarked.contentJson = [
		{ type: "system_injection", source: "living_work_spec", modelText: "目标续跑" },
	];
	expect(foldPeriodicSpecReminders([assistant(), unmarked])).toHaveLength(2);
});
