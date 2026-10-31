import { Button, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlatformInstanceFields } from "./PlatformInstanceFields";
import type { PlatformInstanceRow } from "./PlatformInstancesModal";

/**
 * 单个平台实例的配置。
 *
 * 配置按实例存放（`agent.platformInstances[].config`），与其它实例互不共享：CommandCode
 * 用自己的 apiKey/baseUrl/代理/指纹，Codex 只用自己选中的凭据，TokenDance 额外实例用自己的
 * apiKey（默认前缀那条沿用 `settings.tokendance` 的连接，改在下方连接区块里）。
 */
export function PlatformInstanceSection({
	instance,
	onSave,
	onDelete,
}: {
	instance: PlatformInstanceRow;
	onSave: (config: Record<string, unknown>) => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation("settings");
	// 调用方按实例 id 传 `key`，切换实例时组件重建，草稿不会带到别的实例。
	const [config, setConfig] = useState<Record<string, unknown>>(instance.config ?? {});

	return (
		<Stack gap="sm">
			<Group justify="space-between" align="center">
				<Title order={5}>{instance.name}</Title>
				<Text size="xs" c="dimmed">
					{instance.prefix}
				</Text>
			</Group>
			<Text size="xs" c="dimmed">
				{t("platformInstanceConfigHint")}
			</Text>
			<Divider />
			<PlatformInstanceFields
				platform={instance.platform}
				prefix={instance.prefix}
				config={config}
				onChange={setConfig}
			/>
			<Group justify="space-between">
				<Button color="red" variant="subtle" onClick={onDelete}>
					{t("platformInstanceDelete")}
				</Button>
				<Button onClick={() => onSave(config)}>{t("platformInstanceSave")}</Button>
			</Group>
		</Stack>
	);
}
