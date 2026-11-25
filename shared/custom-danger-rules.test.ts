import { describe, expect, test } from "bun:test";
import {
	type CustomDangerRule,
	compileCustomDangerPattern,
	matchCustomDangerRule,
	sanitizeCustomDangerRules,
} from "./custom-danger-rules";

function rule(overrides: Partial<CustomDangerRule> = {}): CustomDangerRule {
	return {
		id: "rule-1",
		pattern: "^git (commit|push).*$",
		severity: "medium",
		prompt: "反思当前分支是否合理",
		enabled: true,
		...overrides,
	};
}

describe("自定义危险反思规则", () => {
	test("命中命令行文本", () => {
		const hit = matchCustomDangerRule("Bash", ['git commit -m "x"'], [rule()]);
		expect(hit?.rule.id).toBe("rule-1");
		expect(hit?.text).toBe('git commit -m "x"');
	});

	test("不命中时返回 null", () => {
		expect(matchCustomDangerRule("Bash", ["git status"], [rule()])).toBeNull();
	});

	test("停用的规则不参与匹配", () => {
		expect(matchCustomDangerRule("Bash", ["git push"], [rule({ enabled: false })])).toBeNull();
	});

	test("非法正则被忽略而不是抛错", () => {
		expect(compileCustomDangerPattern("(")).toBeNull();
		expect(matchCustomDangerRule("Bash", ["git push"], [rule({ pattern: "(" })])).toBeNull();
	});

	test("超长正则被拒绝", () => {
		expect(compileCustomDangerPattern("a".repeat(301))).toBeNull();
	});

	test("非 Bash 工具用工具名匹配", () => {
		const write = rule({ pattern: "^Write$", severity: "high", prompt: "确认写入目标" });
		expect(matchCustomDangerRule("Write", [], [write])?.text).toBe("Write");
		expect(matchCustomDangerRule("Read", [], [write])).toBeNull();
	});

	test("多条命中取等级最高的一条", () => {
		const rules = [
			rule({ id: "low", severity: "low" }),
			rule({ id: "high", severity: "high" }),
			rule({ id: "medium", severity: "medium" }),
		];
		expect(matchCustomDangerRule("Bash", ["git push"], rules)?.rule.id).toBe("high");
	});

	test("同等级保留先配置的那条", () => {
		const rules = [
			rule({ id: "first", severity: "medium" }),
			rule({ id: "second", severity: "medium" }),
		];
		expect(matchCustomDangerRule("Bash", ["git push"], rules)?.rule.id).toBe("first");
	});

	test("sanitize 丢掉非法条目并去空", () => {
		expect(sanitizeCustomDangerRules([])).toBeUndefined();
		expect(sanitizeCustomDangerRules([rule({ pattern: "(" })])).toBeUndefined();
		const kept = sanitizeCustomDangerRules([rule({ pattern: "(" }), rule({ id: "ok" })]);
		expect(kept?.map((entry) => entry.id)).toEqual(["ok"]);
	});
});
