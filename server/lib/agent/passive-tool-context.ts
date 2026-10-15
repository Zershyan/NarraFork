import { outputToText } from "@shared/agent-protocol/tool-output";
import type { DbMessage } from "@shared/agent-protocol/types";
import { modelTextFromContentBlocks } from "@shared/native-injection";
import { projectMessageSenderText } from "./sender-projection";

function reminderBlock(text: string): string {
	return `<system-reminder>\n${text}\n</system-reminder>`;
}

export function appendAnthropicToolResultContext(results: unknown[], text: string): boolean {
	if (!text.trim()) return false;
	const index = results.length - 1;
	const value = results[index];
	if (!value || typeof value !== "object") return false;
	const result = value as { tool_use_id?: unknown; content?: unknown };
	if (typeof result.tool_use_id !== "string") return false;
	const context = reminderBlock(text);
	if (typeof result.content === "string") {
		results[index] = { ...result, content: `${result.content}\n\n${context}` };
	} else if (Array.isArray(result.content)) {
		results[index] = { ...result, content: [...result.content, { type: "text", text: context }] };
	} else {
		return false;
	}
	return true;
}

// 冷启动与实时投递保持同一形状；真实用户编辑和其他系统注入不降权。
export function foldPeriodicSpecReminders(messages: readonly DbMessage[]): DbMessage[] {
	const result: DbMessage[] = [];
	for (const message of messages) {
		const blocks = Array.isArray(message.contentJson) ? message.contentJson : [];
		const periodic =
			message.role === "sys" &&
			!message.parentToolUseId &&
			blocks.some(
				(block) =>
					block?.type === "system_injection" &&
					block.source === "living_work_spec" &&
					block.body?.kind === "tasks" &&
					typeof block.body.cadenceInterval === "number" &&
					block.body.cadenceInterval > 0,
			);
		const previous = result.at(-1);
		if (
			!periodic ||
			previous?.role !== "assistant" ||
			previous.parentToolUseId ||
			!previous.toolCalls
		) {
			result.push(message);
			continue;
		}
		const index = previous.toolCalls.findLastIndex(
			(call) => call.status === "success" || call.status === "fail",
		);
		if (index < 0) {
			result.push(message);
			continue;
		}
		const text = modelTextFromContentBlocks(blocks) || message.contentText || "";
		if (!text.trim()) {
			result.push(message);
			continue;
		}
		const toolCalls = [...previous.toolCalls];
		const call = toolCalls[index];
		toolCalls[index] = {
			...call,
			outputJson: `${outputToText(call.outputJson)}\n\n${reminderBlock(projectMessageSenderText(message, text))}`,
		};
		result[result.length - 1] = { ...previous, toolCalls };
	}
	return result;
}
