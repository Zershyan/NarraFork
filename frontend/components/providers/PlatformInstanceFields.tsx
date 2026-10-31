import { api } from "@frontend/lib/api";
import { MultiSelect, PasswordInput, Stack, Switch, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ProxyOverride } from "../../lib/proxy";
import { ProxyOverrideField } from "../common/ProxyOverrideField";
import { ClientFingerprintFields } from "./ClientFingerprintFields";
import type { PlatformInstanceKindValue } from "./PlatformInstancesModal";

/**
 * 平台实例的配置字段（添加与编辑共用）。
 *
 * 只读写实例自己的 config：CommandCode 的 key/baseUrl/代理/指纹，Codex 的开关与凭据选择，
 * TokenDance 的 apiKey。默认前缀的 TokenDance 沿用内置连接记录，不在这里出现。
 */
export function PlatformInstanceFields({
	platform,
	prefix,
	config,
	onChange,
}: {
	platform: PlatformInstanceKindValue;
	/** 用于判断是否默认前缀（TokenDance 的内置连接）。 */
	prefix?: string;
	config: Record<string, unknown>;
	onChange: (next: Record<string, unknown>) => void;
}) {
	const { t } = useTranslation("settings");
	const setValue = (key: string, value: unknown) => onChange({ ...config, [key]: value });

	// Codex 实例只能使用自己选中的凭据，所以这里要列出凭据池供选择。
	const { data: codexStatus } = useQuery({
		queryKey: ["codex", "status", "platform-instance"],
		queryFn: () => api.codexStatus(),
		enabled: platform === "codex",
		staleTime: 30_000,
	});
	const credentialOptions = useMemo(
		() =>
			(codexStatus?.entries ?? [])
				.filter((entry) => !entry.archivedAt)
				.map((entry) => ({
					value: entry.id,
					label: entry.displayName ?? entry.email ?? entry.id,
				})),
		[codexStatus?.entries],
	);

	if (platform === "CommandCode") {
		return (
			<Stack gap="sm">
				<PasswordInput
					label={t("platformInstanceApiKey")}
					value={String(config.apiKey ?? "")}
					onChange={(event) => setValue("apiKey", event.currentTarget.value)}
				/>
				<TextInput
					label={t("platformInstanceBaseUrl")}
					value={String(config.baseUrl ?? "")}
					onChange={(event) => setValue("baseUrl", event.currentTarget.value)}
				/>
				<ProxyOverrideField
					value={config.proxy as ProxyOverride | undefined}
					onChange={(next) => setValue("proxy", next)}
				/>
				<ClientFingerprintFields
					value={{
						userAgentMode: config.userAgentMode as
							| "narrafork"
							| "claude-code"
							| "codex"
							| "custom"
							| undefined,
						customUserAgent: config.customUserAgent as string | undefined,
						extraHeaders: config.extraHeaders as Record<string, string> | undefined,
					}}
					onChange={(next) => onChange({ ...config, ...next })}
				/>
			</Stack>
		);
	}

	if (platform === "codex") {
		return (
			<Stack gap="sm">
				<Switch
					label={t("platformInstanceWebSocket")}
					checked={config.useWebSocket !== false}
					onChange={(event) => setValue("useWebSocket", event.currentTarget.checked)}
				/>
				<Switch
					label={t("platformInstanceWebSearch")}
					checked={config.useWebSearch !== false}
					onChange={(event) => setValue("useWebSearch", event.currentTarget.checked)}
				/>
				<Switch
					label={t("platformInstanceImageGeneration")}
					checked={config.useImageGeneration !== false}
					onChange={(event) => setValue("useImageGeneration", event.currentTarget.checked)}
				/>
				<MultiSelect
					label={t("platformInstanceCodexCredentials")}
					description={t("platformInstanceCodexCredentialsHint")}
					data={credentialOptions}
					value={(config.credentialIds as string[] | undefined) ?? []}
					onChange={(value) => setValue("credentialIds", value)}
					searchable
					clearable
				/>
			</Stack>
		);
	}

	// 默认前缀的 TokenDance 实例沿用 settings.tokendance 的连接，改在连接区块里。
	if (prefix === "tokendance") return null;
	return (
		<PasswordInput
			label={t("platformInstanceApiKey")}
			value={String(config.apiKey ?? "")}
			onChange={(event) => setValue("apiKey", event.currentTarget.value)}
		/>
	);
}
