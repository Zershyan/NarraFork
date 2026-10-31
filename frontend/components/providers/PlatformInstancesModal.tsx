import {
	ActionIcon,
	Button,
	Code,
	Divider,
	Group,
	Modal,
	Select,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultInstanceNaming } from "../../../shared/platform-instances";
import { PlatformInstanceFields } from "./PlatformInstanceFields";

/** 平台集成的三个内置平台；名称与默认前缀要和 server 侧 PLATFORM_DEFAULTS 保持一致。 */
const PLATFORM_OPTIONS = [
	{ value: "codex", label: "Codex", basePrefix: "codex", baseName: "Codex" },
	{
		value: "CommandCode",
		label: "Command Code",
		basePrefix: "CommandCode",
		baseName: "Command Code",
	},
	{ value: "tokendance", label: "TokenDance", basePrefix: "tokendance", baseName: "TokenDance" },
] as const;

export type PlatformInstanceKindValue = (typeof PLATFORM_OPTIONS)[number]["value"];

export interface PlatformInstanceRow {
	id: string;
	platform: PlatformInstanceKindValue;
	name: string;
	suffix: string;
	prefix: string;
	disabled: boolean;
	config: Record<string, unknown>;
}

export interface NewPlatformInstance {
	platform: PlatformInstanceKindValue;
	name: string;
	suffix: string;
	prefix: string;
	/** 只包含本实例自己的配置；绝不合并任何已存在平台的配置。 */
	config: Record<string, unknown>;
}

/** 各平台的空白配置：新建实例一律从空白开始。 */
function emptyConfig(platform: PlatformInstanceKindValue): Record<string, unknown> {
	switch (platform) {
		case "codex":
			return {
				useWebSocket: true,
				useWebSearch: true,
				useImageGeneration: true,
				credentialIds: [],
			};
		case "CommandCode":
			return { apiKey: "", baseUrl: "" };
		case "tokendance":
			return { apiKey: "" };
	}
}

/**
 * 平台实例管理：上半部分是已有实例（改名 / 删除），下半部分先填配置再添加同平台的另一个实例。
 *
 * 名称可以自由填写（中文也行），前缀由系统按平台默认前缀加序号生成、创建后不可改：前缀是
 * 模型 ID 的一部分，改了会让已选中的模型失效。新实例的配置只来自这里的表单，空着就是空着，
 * 不会复制已有平台的凭据。
 */
export function PlatformInstancesModal({
	opened,
	onClose,
	instances,
	reservedPrefixes,
	onAdd,
	onRename,
	onDelete,
}: {
	opened: boolean;
	onClose: () => void;
	instances: readonly PlatformInstanceRow[];
	reservedPrefixes: readonly string[];
	onAdd: (instance: NewPlatformInstance) => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
}) {
	const { t } = useTranslation("settings");
	const [platform, setPlatform] = useState<PlatformInstanceKindValue>("codex");
	const [name, setName] = useState("");
	const [config, setConfig] = useState<Record<string, unknown>>(() => emptyConfig("codex"));
	const option = PLATFORM_OPTIONS.find((entry) => entry.value === platform) ?? PLATFORM_OPTIONS[0];

	const existingPrefixes = useMemo(
		() => [...reservedPrefixes, ...instances.map((instance) => instance.prefix)],
		[reservedPrefixes, instances],
	);
	const existingNames = useMemo(() => instances.map((instance) => instance.name), [instances]);

	// 每次打开、切换平台或增删实例都重置表单：默认名称要跟着变，配置也要换成该平台的空白值。
	const naming = useMemo(
		() =>
			defaultInstanceNaming({
				basePrefix: option.basePrefix,
				baseName: option.baseName,
				takenPrefixes: existingPrefixes,
				takenNames: existingNames,
			}),
		[option.basePrefix, option.baseName, existingPrefixes, existingNames],
	);
	useEffect(() => {
		if (!opened) return;
		setName(naming.name);
		setConfig(emptyConfig(option.value));
	}, [opened, naming.name, option.value]);

	const canAdd = name.trim().length > 0;

	return (
		<Modal opened={opened} onClose={onClose} title={t("platformInstanceModalTitle")} size="md">
			<Stack gap="sm">
				{instances.length > 0 && (
					<>
						<Text size="xs" c="dimmed">
							{t("platformInstanceExistingHint")}
						</Text>
						{instances.map((instance) => (
							<Group key={instance.id} gap="xs" wrap="nowrap">
								<Text size="xs" c="dimmed" w={140} style={{ flexShrink: 0 }}>
									{instance.prefix}
								</Text>
								<TextInput
									size="xs"
									style={{ flex: 1 }}
									defaultValue={instance.name}
									onBlur={(event) => {
										const next = event.currentTarget.value.trim();
										if (next && next !== instance.name) onRename(instance.id, next);
									}}
								/>
								<ActionIcon
									size="sm"
									color="red"
									variant="subtle"
									aria-label={t("platformInstanceDelete")}
									onClick={() => onDelete(instance.id)}
								>
									<IconTrash size={14} />
								</ActionIcon>
							</Group>
						))}
						<Divider my="xs" />
					</>
				)}
				<Select
					label={t("platformInstancePlatform")}
					data={PLATFORM_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
					value={platform}
					onChange={(value) => value && setPlatform(value as PlatformInstanceKindValue)}
					allowDeselect={false}
				/>
				<TextInput
					label={t("platformInstanceName")}
					description={t("platformInstanceNameHint")}
					value={name}
					onChange={(event) => setName(event.currentTarget.value)}
					error={!canAdd}
				/>
				<div>
					<Text size="xs" fw={500}>
						{t("platformInstancePrefix")}
					</Text>
					<Group gap="xs">
						<Code>{naming.prefix}</Code>
						<Text size="xs" c="dimmed">
							{t("platformInstancePrefixHint")}
						</Text>
					</Group>
				</div>
				<PlatformInstanceFields platform={platform} config={config} onChange={setConfig} />
				<Group justify="flex-end" gap="xs">
					<Button variant="default" onClick={onClose}>
						{t("common:cancel")}
					</Button>
					<Button
						disabled={!canAdd}
						onClick={() => {
							onAdd({
								platform,
								name: name.trim(),
								suffix: naming.suffix,
								prefix: naming.prefix,
								config,
							});
							onClose();
						}}
					>
						{t("platformInstanceAdd")}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
