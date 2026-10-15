import { expect, test } from "bun:test";
import { type EventHandlerContext, processEvent } from "../narrator-event-handler";

test("隐藏推理开始与结束更新状态，不伪造正文或首字延迟", async () => {
	const statuses = new Set<string>();
	let ttft: number | undefined;
	const ctx = {
		narratorId: "hidden-reasoning-test",
		broadcastTargetId: "hidden-reasoning-test",
		getSubstatus: () => statuses,
		addSubstatus: async (status: string) => {
			statuses.add(status);
		},
		removeSubstatus: async (status: string) => {
			statuses.delete(status);
		},
		getTtftMs: () => ttft,
		setTtftMs: (value: number) => {
			ttft = value;
		},
	} as EventHandlerContext;

	await processEvent({ type: "reasoning_status", active: true }, ctx);
	expect(statuses.has("reasoning")).toBe(true);
	expect(ttft).toBeUndefined();
	await processEvent({ type: "reasoning_status", active: false }, ctx);
	expect(statuses.has("reasoning")).toBe(false);
	expect(ttft).toBeUndefined();
});

test("缺少状态接缝或状态发布失败时不破坏模型流", async () => {
	const ctx = {
		narratorId: "hidden-reasoning-test",
		broadcastTargetId: "hidden-reasoning-test",
	} as EventHandlerContext;
	await expect(processEvent({ type: "reasoning_status", active: true }, ctx)).resolves.toBeNull();
	ctx.addSubstatus = async () => {
		throw new Error("状态发布不可用");
	};
	await expect(processEvent({ type: "reasoning_status", active: true }, ctx)).resolves.toBeNull();
});
