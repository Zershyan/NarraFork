import { afterEach, describe, expect, test } from "bun:test";
import type { BashAnalysis } from "../../lib/agent/bash-analyze";
import { settings } from "../../lib/settings";
import { classifyDanger } from "../narrator-permission";

const originalRules = settings.agent.dangerReflectionRules;

afterEach(() => {
	settings.agent.dangerReflectionRules = originalRules;
});

/** 只填判定用得到的字段：自定义规则读 `commands[].text`，内置判定读其余字段。 */
function analysis(texts: string[], dangerousPatterns: string[] = []): BashAnalysis {
	return {
		commands: texts.map((text) => ({ tokens: text.split(" "), text, fullText: text })),
		filePaths: [],
		allWhitelisted: true,
		nonWhitelisted: [],
		dangerousPatterns,
		hasEnvInjection: false,
		hasWriteOperation: false,
	} as unknown as BashAnalysis;
}

function setRules(rules: Array<Record<string, unknown>>) {
	settings.agent.dangerReflectionRules = rules as unknown as typeof originalRules;
}

describe("自定义危险反思规则接入 classifyDanger", () => {
	test("命中规则时产出对应等级，提示就是反思标题", () => {
		setRules([
			{
				id: "r1",
				pattern: "^git (commit|push).*$",
				severity: "medium",
				prompt: "反思当前分支是否合理",
				enabled: true,
			},
		]);

		const danger = classifyDanger("Bash", { command: "git push" }, "/tmp", analysis(["git push"]));

		expect(danger?.severity).toBe("medium");
		expect(danger?.summary).toBe("反思当前分支是否合理");
		expect(danger?.details?.some((line) => line.includes("^git (commit|push).*$"))).toBe(true);
	});

	test("内置判定更严重时保留内置结论", () => {
		setRules([
			{ id: "r1", pattern: "^rm ", severity: "low", prompt: "确认删除范围", enabled: true },
		]);

		const danger = classifyDanger(
			"Bash",
			{ command: "rm -rf build" },
			"/tmp",
			analysis(["rm -rf build"]),
		);

		expect(danger?.severity).toBe("high");
		expect(danger?.summary).not.toBe("确认删除范围");
	});

	test("规则等级更高时覆盖内置结论", () => {
		setRules([
			{ id: "r1", pattern: "^rm ", severity: "critical", prompt: "确认删除范围", enabled: true },
		]);

		const danger = classifyDanger(
			"Bash",
			{ command: "rm -rf build" },
			"/tmp",
			analysis(["rm -rf build"]),
		);

		expect(danger?.severity).toBe("critical");
		expect(danger?.summary).toBe("确认删除范围");
	});

	test("停用的规则不生效", () => {
		setRules([
			{ id: "r1", pattern: "^git push$", severity: "high", prompt: "确认", enabled: false },
		]);

		expect(
			classifyDanger("Bash", { command: "git push" }, "/tmp", analysis(["git push"])),
		).toBeNull();
	});

	test("非法正则被跳过，其它规则照常生效", () => {
		setRules([
			{ id: "bad", pattern: "(", severity: "critical", prompt: "坏的", enabled: true },
			{ id: "good", pattern: "^git push$", severity: "medium", prompt: "好的", enabled: true },
		]);

		const danger = classifyDanger("Bash", { command: "git push" }, "/tmp", analysis(["git push"]));

		expect(danger?.severity).toBe("medium");
		expect(danger?.summary).toBe("好的");
	});

	test("非 Bash 工具按工具名匹配", () => {
		setRules([
			{ id: "r1", pattern: "^Write$", severity: "high", prompt: "确认写入目标", enabled: true },
		]);

		const danger = classifyDanger("Write", { file_path: "/tmp/x.txt", content: "x" }, "/tmp");

		expect(danger?.severity).toBe("high");
		expect(danger?.summary).toBe("确认写入目标");
	});

	test("没有配置规则时行为与之前一致", () => {
		setRules([]);
		expect(
			classifyDanger("Bash", { command: "git status" }, "/tmp", analysis(["git status"])),
		).toBeNull();
	});
});
