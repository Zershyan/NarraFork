/**
 * CommandCode 实例级账号池：一个实例可以填多把 key，按模式挑一把用，失效的自动避开。
 *
 * 纯逻辑，不碰 I/O 也不读写设置——调用方把 config 传进来，拿回新的数组自己写回。
 * 调度语义对齐 Codex 的凭据池，但粒度是实例级，不引入平台单例。
 */

export type CommandCodeLoadBalancing = "priority" | "balanced";

export interface CommandCodeAccount {
	id: string;
	apiKey: string;
	label?: string;
	enabled: boolean;
	/** 失效原因；缺席表示健康。 */
	disabledReason?: "auth" | "quota" | "rate_limit";
	/** 临时停用的恢复时刻（epoch ms）；缺席表示需要手动恢复。 */
	disabledUntil?: number;
}

export interface CommandCodePoolConfig {
	/** 旧版单一 key；仍然有效，读作池里的一条。 */
	apiKey?: string;
	accounts?: readonly CommandCodeAccount[];
	loadBalancing?: CommandCodeLoadBalancing;
}

/** 从 `apiKey` 读出来的那一条，写回时同步回 `apiKey`。 */
export const LEGACY_ACCOUNT_ID = "legacy";

/** 限流默认停一分钟；配额墙默认停一小时，都由上游的 retry-after 覆盖。 */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
const DEFAULT_QUOTA_PAUSE_MS = 60 * 60_000;

/**
 * 池的内容：`accounts` 加上从 `apiKey` 读出的那一条，去掉空值与重复的 key。
 * 同一把 key 出现两次只会请求两次失败，因此按 key 去重而不是按 id。
 */
export function commandCodeAccountsOf(config?: CommandCodePoolConfig): CommandCodeAccount[] {
	const seen = new Set<string>();
	const accounts: CommandCodeAccount[] = [];
	for (const account of config?.accounts ?? []) {
		const apiKey = account.apiKey.trim();
		if (!apiKey || seen.has(apiKey)) continue;
		seen.add(apiKey);
		accounts.push({ ...account, apiKey });
	}
	const legacy = config?.apiKey?.trim();
	if (legacy && !seen.has(legacy))
		accounts.unshift({ id: LEGACY_ACCOUNT_ID, apiKey: legacy, enabled: true });
	return accounts;
}

/** 现在能不能用：启用中，且没有未到期的临时停用。 */
export function isAccountAvailable(account: CommandCodeAccount, now: number = Date.now()): boolean {
	if (!account.enabled) return false;
	return account.disabledUntil === undefined || account.disabledUntil <= now;
}

export interface CommandCodeSelection {
	account: CommandCodeAccount;
	/** 下一次从这里开始找，实现 balanced 的轮转。 */
	nextCursor: number;
}

/**
 * 挑一把可用的 key。
 *
 * - `priority`：按池里的顺序取第一个可用的，主备语义
 * - `balanced`：从游标处开始轮转，把请求摊到各把 key 上
 */
export function selectCommandCodeAccount(
	accounts: readonly CommandCodeAccount[],
	mode: CommandCodeLoadBalancing = "balanced",
	cursor = 0,
	now: number = Date.now(),
): CommandCodeSelection | undefined {
	if (mode === "priority") {
		const index = accounts.findIndex((account) => isAccountAvailable(account, now));
		const account = index < 0 ? undefined : accounts[index];
		return account ? { account, nextCursor: index + 1 } : undefined;
	}
	for (let step = 0; step < accounts.length; step += 1) {
		const index = (Math.max(0, cursor) + step) % accounts.length;
		const account = accounts[index];
		if (account && isAccountAvailable(account, now)) return { account, nextCursor: index + 1 };
	}
	return undefined;
}

/**
 * 记下一次失效，返回新数组（不改入参）。
 *
 * 认证失败是永久的，直到手动重新启用；限流与配额按窗口自动恢复。
 */
export function applyAccountFailure(
	accounts: readonly CommandCodeAccount[],
	id: string,
	reason: NonNullable<CommandCodeAccount["disabledReason"]>,
	options: { retryAfterMs?: number; now?: number } = {},
): CommandCodeAccount[] {
	const now = options.now ?? Date.now();
	const fallback = reason === "quota" ? DEFAULT_QUOTA_PAUSE_MS : DEFAULT_RATE_LIMIT_PAUSE_MS;
	return accounts.map((account) => {
		if (account.id !== id) return account;
		if (reason === "auth")
			return { ...account, enabled: false, disabledReason: reason, disabledUntil: undefined };
		return {
			...account,
			disabledReason: reason,
			// 至少停一秒，避免把上游给的空窗口当成「立刻重试」。
			disabledUntil: now + Math.max(options.retryAfterMs ?? fallback, 1000),
		};
	});
}
