// 「平台集成」的实例清单。
//
// 同一平台可以存在多个实例，它们存在 `agent.platformInstances` 里。清单是唯一事实来源：
// 前缀只由清单决定，删光就是真的没有平台；更早版本的单例字段（`codex` / `commandCode` /
// `tokendance`）只在启动迁移时读一次，落成每个类型的初始实例。
//
// 纯函数，不读全局 settings，便于单测与迁移调用。

export type PlatformInstanceKind = "codex" | "CommandCode" | "tokendance";

export interface PlatformInstance {
	id: string;
	platform: PlatformInstanceKind;
	name: string;
	/** 用户可改的后缀；空串表示沿用平台默认前缀。 */
	suffix: string;
	/** 模型 ID 前缀（`<prefix>:<model>`），必须全局唯一。 */
	prefix: string;
	disabled: boolean;
	/** 各平台原有的配置形状。 */
	config: Record<string, unknown>;
}

/** 平台默认前缀与显示名：初始实例与「添加平台」弹窗的默认值都用它。 */
export const PLATFORM_DEFAULTS: Record<PlatformInstanceKind, { prefix: string; name: string }> = {
	codex: { prefix: "codex", name: "Codex" },
	CommandCode: { prefix: "CommandCode", name: "Command Code" },
	tokendance: { prefix: "tokendance", name: "TokenDance" },
};

/** 迁移来源：三个平台旧的单例字段，键是设置里的字段名（`commandCode` 小写开头）。 */
export interface LegacyPlatformSettings {
	codex?: unknown;
	commandCode?: unknown;
	tokendance?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function boolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * 一个平台的初始 config。
 *
 * Codex 的 config 只有开关，凭据仍留在账号池里；TokenDance 的**内置前缀**沿用
 * `settings.tokendance` 这条连接记录（连接、支付、OAuth 都在那里），所以 config 留空，
 * 只有额外实例才把 apiKey 写进自己的 config。
 */
function initialConfig(platform: PlatformInstanceKind, legacy: unknown): Record<string, unknown> {
	if (platform === "tokendance") return {};
	const config = record(legacy);
	if (platform === "codex") {
		return {
			useWebSocket: boolean(config?.useWebSocket, true),
			useWebSearch: boolean(config?.useWebSearch, true),
			useImageGeneration: boolean(config?.useImageGeneration, true),
		};
	}
	return config ? { ...config } : {};
}

/**
 * 启动迁移的初始实例：每个平台类型各一条，带上旧单例里已有的配置。
 *
 * 没配置过的类型也给一条空 config：用户既可以直接在卡片上补配置，也可以把它删掉。
 * 只在设置文件里还没有清单时调用一次，之后清单就是唯一事实来源。
 */
export function initialPlatformInstances(source: {
	legacy?: LegacyPlatformSettings;
	disabledProviders?: readonly string[];
}): PlatformInstance[] {
	const disabled = new Set(source.disabledProviders ?? []);
	return (Object.keys(PLATFORM_DEFAULTS) as PlatformInstanceKind[]).map((platform) => {
		const defaults = PLATFORM_DEFAULTS[platform];
		const legacyKey = platform === "CommandCode" ? "commandCode" : platform;
		return {
			id: `platform-${platform}`,
			platform,
			name: defaults.name,
			suffix: "",
			prefix: defaults.prefix,
			disabled: disabled.has(defaults.prefix),
			config: initialConfig(platform, source.legacy?.[legacyKey]),
		};
	});
}
