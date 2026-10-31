import { describe, expect, test } from "bun:test";
import { composeInstancePrefix, defaultInstanceNaming } from "./platform-instances";

describe("platform instance naming", () => {
	test("前缀由平台默认前缀与序号拼成", () => {
		expect(composeInstancePrefix("codex", "2")).toBe("codex-2");
		expect(composeInstancePrefix("codex", "")).toBe("codex");
	});

	test("默认命名让名称与前缀各自避让", () => {
		expect(
			defaultInstanceNaming({
				basePrefix: "codex",
				baseName: "Codex",
				takenPrefixes: ["codex"],
				takenNames: ["Codex"],
			}),
		).toEqual({ suffix: "2", name: "Codex-2", prefix: "codex-2" });

		// 前缀空着但名字被占：继续递增，不产生重名
		expect(
			defaultInstanceNaming({
				basePrefix: "codex",
				baseName: "Codex",
				takenPrefixes: ["codex"],
				takenNames: ["Codex", "Codex-2"],
			}),
		).toEqual({ suffix: "3", name: "Codex-3", prefix: "codex-3" });
	});

	test("自定义过的名字不影响默认前缀的选择", () => {
		expect(
			defaultInstanceNaming({
				basePrefix: "codex",
				baseName: "Codex",
				takenPrefixes: ["codex", "codex-2"],
				takenNames: ["我的 Codex", "Codex-2"],
			}),
		).toEqual({ suffix: "3", name: "Codex-3", prefix: "codex-3" });
	});
});
