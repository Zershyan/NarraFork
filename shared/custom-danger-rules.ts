/**
 * 自定义危险反思规则（设置 → AI 代理 → 危险反思）。
 *
 * 每条规则是「正则 + 等级 + 反思提示」：工具调用命中正则时，以这条规则的等级与提示参与
 * 危险判定，与内置判定取更严重者 —— 规则只能让判定更严，永远不能放宽内置结论。
 *
 * 匹配对象是「工具调用的可读文本」：Bash 逐条子命令文本（`git commit -m "x"`），其余工具
 * 用工具名（`^Write$`）。这样 `^git (commit|push).*$` 这类写法对 `cd x && git push` 里的
 * 每条子命令都成立。
 */

export type CustomDangerRuleSeverity = "low" | "medium" | "high" | "critical";

export const CUSTOM_DANGER_RULE_SEVERITIES: readonly CustomDangerRuleSeverity[] = [
	"low",
	"medium",
	"high",
	"critical",
];

export const MAX_CUSTOM_DANGER_RULES = 50;
/**
 * 正则长度上限。给到 2 KiB：像「命令行里任意位置、任意引号/转义/前缀写法下的 git」这种
 * 精确识别用的正则本身就有上千字符，300 这类小上限会把它们挡在门外。
 */
export const MAX_CUSTOM_DANGER_PATTERN_CHARS = 2048;
export const MAX_CUSTOM_DANGER_PROMPT_CHARS = 500;

export interface CustomDangerRule {
	id: string;
	/** 正则源码；非法或不合法长度时这条规则被忽略（UI 会同时提示）。 */
	pattern: string;
	severity: CustomDangerRuleSeverity;
	/** 反思提示：命中后直接作为反思标题，也是模型要照做的指令。 */
	prompt: string;
	enabled: boolean;
}

const SEVERITY_RANK: Record<CustomDangerRuleSeverity, number> = {
	low: 0,
	medium: 1,
	high: 2,
	critical: 3,
};

export function customDangerSeverityRank(severity: CustomDangerRuleSeverity): number {
	return SEVERITY_RANK[severity] ?? 0;
}

/** 编译结果按正则源码缓存：工具调用是热路径，不能每次都重编译。 */
const compiledPatterns = new Map<string, RegExp | null>();

/** 编译一条规则的正则；超长或语法非法返回 null。 */
export function compileCustomDangerPattern(pattern: string): RegExp | null {
	if (!pattern || pattern.length > MAX_CUSTOM_DANGER_PATTERN_CHARS) return null;
	const cached = compiledPatterns.get(pattern);
	if (cached !== undefined) return cached;
	let regex: RegExp | null = null;
	try {
		regex = new RegExp(pattern);
	} catch {
		regex = null;
	}
	compiledPatterns.set(pattern, regex);
	return regex;
}

export interface CustomDangerMatch {
	rule: CustomDangerRule;
	/** 真正命中的那段文本，写进反思详情用。 */
	text: string;
}

/**
 * 找出命中的规则；多条命中时取等级最高的一条。
 *
 * 早期返回按等级排序的写法没必要：规则数量有上限（50），一次线性扫描足够，而且能保证
 * 同一等级下「先配置的那条」稳定胜出。
 */
export function matchCustomDangerRule(
	toolName: string,
	commandTexts: readonly string[],
	rules: readonly CustomDangerRule[] | undefined,
): CustomDangerMatch | null {
	if (!rules?.length) return null;
	const texts = commandTexts.length > 0 ? commandTexts : [toolName];
	let best: CustomDangerMatch | null = null;
	for (const rule of rules) {
		if (!rule.enabled) continue;
		const regex = compileCustomDangerPattern(rule.pattern);
		if (!regex) continue;
		const text = texts.find((candidate) => regex.test(candidate));
		if (text === undefined) continue;
		if (
			!best ||
			customDangerSeverityRank(rule.severity) > customDangerSeverityRank(best.rule.severity)
		) {
			best = { rule, text };
		}
	}
	return best;
}

/** 设置里保存的规则：丢掉长度越界或正则非法的条目，避免坏数据长期留在配置里。 */
export function sanitizeCustomDangerRules(
	rules: readonly CustomDangerRule[] | undefined,
): CustomDangerRule[] | undefined {
	if (!rules) return undefined;
	const kept = rules
		.filter(
			(rule) =>
				!!rule &&
				typeof rule.id === "string" &&
				typeof rule.pattern === "string" &&
				typeof rule.prompt === "string" &&
				compileCustomDangerPattern(rule.pattern) !== null &&
				rule.prompt.length <= MAX_CUSTOM_DANGER_PROMPT_CHARS &&
				CUSTOM_DANGER_RULE_SEVERITIES.includes(rule.severity),
		)
		.slice(0, MAX_CUSTOM_DANGER_RULES);
	return kept.length > 0 ? kept : undefined;
}
