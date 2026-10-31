import { describe, expect, test } from "bun:test";
import { initialPlatformInstances, PLATFORM_DEFAULTS } from "./platform-instances";

describe("platform instance migration", () => {
	test("每个平台类型各生成一个初始实例，前缀用平台默认值", () => {
		const instances = initialPlatformInstances({
			legacy: { codex: { loadBalancingMode: "tier-balanced" }, commandCode: { apiKey: "k" } },
			disabledProviders: ["CommandCode"],
		});
		expect(instances.map((instance) => instance.prefix)).toEqual([
			"codex",
			"CommandCode",
			"tokendance",
		]);
		expect(instances[0]).toMatchObject({
			platform: "codex",
			name: PLATFORM_DEFAULTS.codex.name,
			suffix: "",
			disabled: false,
		});
		// 旧版的停用清单映射到实例的 disabled
		expect(instances[1]).toMatchObject({ prefix: "CommandCode", disabled: true });
	});

	test("旧的 CommandCode 配置整份带进实例，Codex 只带开关（凭据仍在账号池）", () => {
		const [codex, commandCode] = initialPlatformInstances({
			legacy: {
				codex: { useWebSocket: false, loadBalancingMode: "tier-balanced" },
				commandCode: { apiKey: "k", baseUrl: "https://example.test" },
			},
		});
		expect(codex?.config).toEqual({
			useWebSocket: false,
			useWebSearch: true,
			useImageGeneration: true,
		});
		expect(commandCode?.config).toEqual({ apiKey: "k", baseUrl: "https://example.test" });
	});

	test("从未配置过的平台也给一条空实例，用户可以直接补配置或删掉", () => {
		const instances = initialPlatformInstances({});
		expect(instances).toHaveLength(3);
		// TokenDance 的默认前缀沿用既有连接记录，config 留空
		expect(instances.find((instance) => instance.platform === "tokendance")?.config).toEqual({});
	});
});
