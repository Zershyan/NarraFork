/**
 * 平台实例的命名规则。
 *
 * 「平台集成」（Codex / Command Code / TokenDance）允许同一平台存在多个实例，实例靠
 * `prefix` 区分（模型 value 是 `<prefix>:<model>`），而 `prefix` 必须唯一且能安全用于
 * 模型 ID。前缀一律由平台默认前缀加序号生成、创建后不可改；显示名可以自由填写，这里只给
 * 一个避让重名的默认值。纯计算，不碰设置存储。
 */

/** 把平台基础前缀与后缀拼成实例前缀；空后缀表示沿用基础前缀。 */
export function composeInstancePrefix(basePrefix: string, suffix: string): string {
	const trimmed = suffix.trim();
	return trimmed ? `${basePrefix}-${trimmed}` : basePrefix;
}

export interface InstanceNamingInput {
	basePrefix: string;
	/** 平台显示名，例如 `Codex`。 */
	baseName: string;
	/** 已存在的实例前缀（含其他平台）。 */
	takenPrefixes: Iterable<string>;
	/** 已存在的实例显示名，用于给默认名避让。 */
	takenNames: Iterable<string>;
}

export interface InstanceNaming {
	suffix: string;
	name: string;
	prefix: string;
}

/**
 * 新实例的默认命名：序号从 2 开始取第一个前缀与默认名都空着的值。
 *
 * 名称冲突与前缀冲突是两件事（用户可以只改名称），所以两者都从同一个序号出发各自避让。
 */
export function defaultInstanceNaming(input: InstanceNamingInput): InstanceNaming {
	const takenPrefixes = new Set(input.takenPrefixes);
	const takenNames = new Set(input.takenNames);
	for (let n = 2; ; n += 1) {
		const suffix = String(n);
		const prefix = composeInstancePrefix(input.basePrefix, suffix);
		const name = `${input.baseName}-${suffix}`;
		if (!takenPrefixes.has(prefix) && !takenNames.has(name)) return { suffix, name, prefix };
	}
}
