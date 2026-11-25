/**
 * 自定义危险反思规则的编辑弹窗（设置 → AI 代理 → 危险反思）。
 *
 * 每条规则是「正则 + 等级 + 反思提示」。改动直接写回设置草稿，由设置页底部的保存条统一
 * 提交，所以这里没有自己的保存按钮，关掉对话框不会丢东西。
 */

import {
	ActionIcon,
	Alert,
	Button,
	Code,
	Group,
	Modal,
	Paper,
	Select,
	Stack,
	Switch,
	Text,
	Textarea,
	TextInput,
} from "@mantine/core";
import {
	CUSTOM_DANGER_RULE_SEVERITIES,
	type CustomDangerRule,
	type CustomDangerRuleSeverity,
	compileCustomDangerPattern,
	MAX_CUSTOM_DANGER_PATTERN_CHARS,
	MAX_CUSTOM_DANGER_PROMPT_CHARS,
	MAX_CUSTOM_DANGER_RULES,
} from "@shared/custom-danger-rules";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

function newRuleId(): string {
	return (
		globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}

export function CustomDangerRulesModal({
	opened,
	onClose,
	rules,
	onChange,
}: {
	opened: boolean;
	onClose: () => void;
	rules: CustomDangerRule[];
	onChange: (rules: CustomDangerRule[]) => void;
}) {
	const { t } = useTranslation("settings");
	const [pattern, setPattern] = useState("");
	const [severity, setSeverity] = useState<CustomDangerRuleSeverity>("medium");
	const [prompt, setPrompt] = useState("");

	const trimmedPattern = pattern.trim();
	const patternError =
		trimmedPattern && !compileCustomDangerPattern(trimmedPattern)
			? t("dangerReflectionRulePatternInvalid")
			: null;
	const atLimit = rules.length >= MAX_CUSTOM_DANGER_RULES;
	const canAdd = !!trimmedPattern && !patternError && !!prompt.trim() && !atLimit;

	const addRule = () => {
		if (!canAdd) return;
		onChange([
			...rules,
			{ id: newRuleId(), pattern: trimmedPattern, severity, prompt: prompt.trim(), enabled: true },
		]);
		setPattern("");
		setPrompt("");
	};

	const updateRule = (id: string, patch: Partial<CustomDangerRule>) => {
		onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
	};

	const removeRule = (id: string) => {
		onChange(rules.filter((rule) => rule.id !== id));
	};

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={t("dangerReflectionRulesTitle")}
			size="lg"
			centered
		>
			<Stack gap="md">
				<Text size="sm" c="dimmed">
					{t("dangerReflectionRulesDesc")}
				</Text>

				{rules.length === 0 ? (
					<Text size="sm" c="dimmed">
						{t("dangerReflectionRulesEmpty")}
					</Text>
				) : (
					<Stack gap="xs">
						{rules.map((rule) => (
							<Paper key={rule.id} withBorder p="xs">
								<Group gap="xs" wrap="nowrap" align="flex-start">
									<Switch
										size="sm"
										checked={rule.enabled}
										onChange={(event) =>
											updateRule(rule.id, { enabled: event.currentTarget.checked })
										}
										aria-label={t("dangerReflectionRuleEnabled")}
									/>
									<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
										<Code style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
											{rule.pattern}
										</Code>
										<Text size="xs" c="dimmed">
											{t(`dangerReflectionRuleSeverity_${rule.severity}`)} · {rule.prompt}
										</Text>
									</Stack>
									<ActionIcon
										color="red"
										variant="subtle"
										size="sm"
										onClick={() => removeRule(rule.id)}
										aria-label={t("dangerReflectionRuleDelete")}
									>
										<IconTrash size={14} />
									</ActionIcon>
								</Group>
							</Paper>
						))}
					</Stack>
				)}

				<Alert color={atLimit ? "yellow" : "blue"} variant="light">
					{atLimit
						? t("dangerReflectionRuleLimit", { max: MAX_CUSTOM_DANGER_RULES })
						: t("dangerReflectionRuleHint")}
				</Alert>

				<TextInput
					label={t("dangerReflectionRulePattern")}
					placeholder="^git (commit|push).*$"
					description={t("dangerReflectionRulePatternDesc")}
					value={pattern}
					error={patternError}
					maxLength={MAX_CUSTOM_DANGER_PATTERN_CHARS}
					onChange={(event) => setPattern(event.currentTarget.value)}
					disabled={atLimit}
					styles={{ input: { fontFamily: "monospace" } }}
				/>
				<Select
					label={t("dangerReflectionRuleSeverity")}
					description={t("dangerReflectionRuleSeverityDesc")}
					value={severity}
					onChange={(value) => setSeverity((value ?? "medium") as CustomDangerRuleSeverity)}
					data={CUSTOM_DANGER_RULE_SEVERITIES.map((value) => ({
						value,
						label: t(`dangerReflectionRuleSeverity_${value}`),
					}))}
					disabled={atLimit}
					allowDeselect={false}
				/>
				<Textarea
					label={t("dangerReflectionRulePrompt")}
					description={t("dangerReflectionRulePromptDesc")}
					placeholder={t("dangerReflectionRulePromptPlaceholder")}
					value={prompt}
					maxLength={MAX_CUSTOM_DANGER_PROMPT_CHARS}
					autosize
					minRows={2}
					onChange={(event) => setPrompt(event.currentTarget.value)}
					disabled={atLimit}
				/>

				<Group justify="space-between">
					<Button
						variant="light"
						leftSection={<IconPlus size={14} />}
						onClick={addRule}
						disabled={!canAdd}
					>
						{t("dangerReflectionRuleAdd")}
					</Button>
					<Button variant="default" onClick={onClose}>
						{t("close")}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
