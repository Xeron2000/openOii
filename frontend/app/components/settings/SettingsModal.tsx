import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSettingsStore } from "~/stores/settingsStore";
import { configApi } from "~/services/api";
import type { ConfigItem, ConfigValue } from "~/types";
import { ConfigInput } from "./ConfigInput";
import { groupConfigs } from "~/utils/configGroups";
import {
	XMarkIcon,
	Cog6ToothIcon,
	InformationCircleIcon,
	CircleStackIcon,
	SparklesIcon,
	PhotoIcon,
	VideoCameraIcon,
	WrenchScrewdriverIcon,
	CheckCircleIcon,
	ExclamationCircleIcon,
} from "@heroicons/react/24/outline";

type AlertType = "success" | "error" | "warning";

interface AlertState {
	show: boolean;
	type: AlertType;
	title: string;
	message: string;
	details?: string;
}

export function SettingsModal() {
	const { isModalOpen, closeModal } = useSettingsStore();
	const queryClient = useQueryClient();
	const [formState, setFormState] = useState<Record<string, ConfigValue>>({});
	const [initialFormState, setInitialFormState] = useState<
		Record<string, ConfigValue>
	>({});
	const [activeTab, setActiveTab] = useState("database");
	const [isTestingConnection, setIsTestingConnection] = useState(false);
	const [alertState, setAlertState] = useState<AlertState>({
		show: false,
		type: "success",
		title: "",
		message: "",
	});

	const {
		data: config,
		isLoading,
		isError,
	} = useQuery({
		queryKey: ["config"],
		queryFn: configApi.get,
		enabled: isModalOpen,
	});

	useEffect(() => {
		if (config) {
			const initialState = config.reduce(
				(acc, item) => {
					acc[item.key] = item.value;
					return acc;
				},
				{} as Record<string, ConfigValue>,
			);
			setFormState(initialState);
			setInitialFormState(initialState);
		}
	}, [config]);

	// 切换标签页
	const handleTabChange = (tab: string) => {
		setActiveTab(tab);
	};

	const updateMutation = useMutation({
		mutationFn: (newConfig: Record<string, ConfigValue>) =>
			configApi.update(newConfig),
		onSuccess: (data, submittedConfig) => {
			queryClient.invalidateQueries({ queryKey: ["config"] });
			setInitialFormState((prev) => ({ ...prev, ...submittedConfig }));
			// 不要立即关闭模态框，等用户点击确定后再关闭

			// 根据后端返回判断是否需要重启
			if (data?.restart_required) {
				const keys = data.restart_keys?.join(", ") || "";
				setAlertState({
					show: true,
					type: "warning",
					title: "配置已保存！",
					message: "其他配置已立即生效。",
					details: `以下配置需要重启服务才能生效：\n${keys}`,
				});
			} else {
				setAlertState({
					show: true,
					type: "success",
					title: "保存成功",
					message: "配置已保存并立即生效！",
				});
			}
		},
		onError: (error) => {
			setAlertState({
				show: true,
				type: "error",
				title: "保存失败",
				message: error.message,
			});
		},
	});

	const handleInputChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
	) => {
		const { name, value } = e.target;
		setFormState((prevState) => ({ ...prevState, [name]: value }));
	};

	const getTestConnectionService = () => {
		if (activeTab === "text") {
			return "llm";
		}

		if (activeTab === "image") {
			return "image";
		}

		if (activeTab === "video") {
			return "video";
		}

		return null;
	};

	const handleTestConnection = async () => {
		const service = getTestConnectionService();
		if (!service) {
			return;
		}

		// Only send overrides for fields relevant to the current service.
		// The backend rejects non-whitelisted override keys with 400.
		const servicePrefixes: Record<string, string[]> = {
			llm: ["text_", "anthropic_", "fake_text_"],
			image: ["image_", "fake_image_", "enable_image_to_image"],
			video: [
				"video_",
				"doubao_",
				"fake_video_",
				"enable_image_to_video",
				"video_image_mode",
				"video_inline_local_images",
			],
		};

		const prefixes = servicePrefixes[service];
		const relevantEntries = Object.entries(formState).filter(([key]) => {
			const lower = key.toLowerCase();
			return prefixes.some((p) => lower.startsWith(p) || lower === p);
		});

		const normalizedFormState = Object.fromEntries(
			relevantEntries
				.map(([key, value]) => [key, value === null ? null : String(value)] as const)
				.filter(([key, value]) => {
					// Empty inputs in the test-connection form mean "use the current
					// effective backend value". Sending an empty string would override
					// env/default values and can make fake fixture probes fail.
					if (value !== "") return true;
					const lower = key.toLowerCase();
					return lower.endsWith("_provider") || lower.startsWith("enable_");
				}),
		) as Record<string, string | null>;

		setIsTestingConnection(true);
		try {
			const result = await configApi.testConnection(
				service,
				normalizedFormState,
			);
			const alertType =
				result.status === "degraded"
					? "warning"
					: result.success
						? "success"
						: "error";
			setAlertState({
				show: true,
				type: alertType,
				title:
					result.status === "degraded"
						? "连接测试部分通过"
						: result.success
							? "连接测试成功"
							: "连接测试失败",
				message: result.message,
				details: result.details || undefined,
			});
		} catch (error) {
			setAlertState({
				show: true,
				type: "error",
				title: "连接测试失败",
				message: error instanceof Error ? error.message : "连接测试失败",
			});
		} finally {
			setIsTestingConnection(false);
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const changedConfig = Object.fromEntries(
			Object.entries(formState).filter(([key, value]) => {
				const initialValue = initialFormState[key];
				return String(value ?? "") !== String(initialValue ?? "");
			}),
		);

		if (Object.keys(changedConfig).length === 0) {
			setAlertState({
				show: true,
				type: "success",
				title: "没有变更",
				message: "当前配置已是最新。",
			});
			return;
		}

		updateMutation.mutate(changedConfig);
	};

	const handleCancel = () => {
		if (config) {
			const initialState = config.reduce(
				(acc, item) => {
					acc[item.key] = item.value;
					return acc;
				},
				{} as Record<string, ConfigValue>,
			);
			setFormState(initialState);
		}
		closeModal();
	};

	if (!isModalOpen) {
		return null;
	}

	const sections = config ? groupConfigs(config) : [];

	// 标签页配置
	const tabConfig: Record<
		string,
		{ icon: React.ReactNode; title: string; desc: string }
	> = {
		basic: {
			icon: <WrenchScrewdriverIcon className="w-4 h-4" />,
			title: "基础",
			desc: "应用名称、环境、日志级别等基础配置",
		},
		database: {
			icon: <CircleStackIcon className="w-4 h-4" />,
			title: "数据库",
			desc: "数据库和 Redis 连接配置",
		},
		text: {
			icon: <SparklesIcon className="w-4 h-4" />,
			title: "文本生成",
			desc: "文本生成服务配置，支持 Anthropic、OpenAI 兼容接口和 Fake 本地测试",
		},
		image: {
			icon: <PhotoIcon className="w-4 h-4" />,
			title: "图像服务",
			desc: "图像生成服务配置，默认使用 ModelScope Z-Image-Turbo，也支持 OpenAI 兼容接口和 Fake 本地测试",
		},
		video: {
			icon: <VideoCameraIcon className="w-4 h-4" />,
			title: "视频服务",
			desc: "视频生成服务配置，支持 OpenAI 兼容接口、豆包和 Fake 本地测试",
		},
	};

	const activeSection = sections.find((s) => s.key === activeTab);

	// 获取当前文本服务提供商
	const getTextProvider = () => {
		return (formState["TEXT_PROVIDER"] ||
			formState["text_provider"] ||
			"anthropic") as string;
	};

	// 获取当前视频服务提供商
	const getVideoProvider = () => {
		return (formState["VIDEO_PROVIDER"] ||
			formState["video_provider"] ||
			"openai") as string;
	};

	// 获取当前图像服务提供商
	const getImageProvider = () => {
		return (formState["IMAGE_PROVIDER"] ||
			formState["image_provider"] ||
			"modelscope") as string;
	};

	// 渲染单个配置项
	const renderConfigItem = (item: ConfigItem) => (
		<div
			key={item.key}
			className="bg-base-200 p-4 rounded-lg border-2 border-base-content/30"
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="font-mono font-bold text-sm">
					{item.key.toUpperCase()}
				</span>
				{item.is_sensitive && (
					<span className="badge badge-warning badge-xs">敏感</span>
				)}
				{item.source === "env" && (
					<span className="badge badge-info badge-xs">仅.env</span>
				)}
			</div>
			<ConfigInput
				item={item}
				value={String(formState[item.key] ?? "")}
				onChange={handleInputChange}
			/>
			<p className="text-xs text-base-content/60 mt-2">
				{getConfigDescription(item.key)}
			</p>
		</div>
	);

	// 渲染文本服务配置（特殊处理）
	const renderTextSection = () => {
		if (!activeSection || activeTab !== "text") return null;

		const textProvider = getTextProvider();

		// 分离配置项
		const providerItem = activeSection.items.find(
			(i) => i.key.toLowerCase() === "text_provider",
		);
		const anthropicItems = activeSection.items.filter((i) =>
			i.key.toLowerCase().startsWith("anthropic_"),
		);
		const openaiItems = activeSection.items.filter(
			(i) =>
				i.key.toLowerCase().startsWith("text_") &&
				i.key.toLowerCase() !== "text_provider",
		);

		return (
			<div className="space-y-6">
				{/* 分类描述 */}
				<div className="flex items-center gap-2 text-sm text-info bg-info/10 px-4 py-2 rounded-lg border border-info/30">
					<InformationCircleIcon className="w-4 h-4 shrink-0" />
					<span>{tabConfig[activeTab]?.desc}</span>
				</div>

				{/* 服务提供商选择 */}
				{providerItem && (
					<div className="bg-base-200 p-4 rounded-lg border-2 border-base-content/30">
						<div className="flex items-center gap-2 mb-3">
							<span className="font-mono font-bold text-sm">TEXT_PROVIDER</span>
							<span className="badge badge-primary badge-xs">必选</span>
						</div>
						<div className="flex gap-4">
							<label
								className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									textProvider === "anthropic"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="TEXT_PROVIDER"
									value="anthropic"
									checked={textProvider === "anthropic"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">Anthropic Claude</div>
									<div className="text-xs text-base-content/60">
										Anthropic 兼容接口，推荐使用
									</div>
								</div>
							</label>
							<label
								className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									textProvider === "openai"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="TEXT_PROVIDER"
									value="openai"
									checked={textProvider === "openai"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">OpenAI 兼容</div>
									<div className="text-xs text-base-content/60">
										支持任何 OpenAI 兼容接口
									</div>
								</div>
							</label>
							<label
								className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									textProvider === "fake"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="TEXT_PROVIDER"
									value="fake"
									checked={textProvider === "fake"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">Fake 本地测试</div>
									<div className="text-xs text-base-content/60">
										不调用外部文本 API，避免测试扣费
									</div>
								</div>
							</label>
						</div>
					</div>
				)}

				{/* Anthropic 配置 */}
				{textProvider === "anthropic" && anthropicItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<SparklesIcon className="w-4 h-4" />
							Anthropic Claude 配置
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{anthropicItems.map(renderConfigItem)}
						</div>
					</div>
				)}

				{/* OpenAI 兼容配置 */}
				{textProvider === "openai" && openaiItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<SparklesIcon className="w-4 h-4" />
							OpenAI 兼容接口配置
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{openaiItems.map(renderConfigItem)}
						</div>
					</div>
				)}

				{/* Fake 配置 */}
				{textProvider === "fake" && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<SparklesIcon className="w-4 h-4" />
							Fake 本地测试配置
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{activeSection.items
								.filter((i) => i.key.toLowerCase().startsWith("fake_text_"))
								.map(renderConfigItem)}
							<p className="text-xs text-base-content/60 px-1">
								启用后生成链路不会调用外部文本生成 API。
							</p>
						</div>
					</div>
				)}
			</div>
		);
	};

	// 渲染图像服务配置（支持 fake 本地测试）
	const renderImageSection = () => {
		if (!activeSection || activeTab !== "image") return null;

		const imageProvider = getImageProvider();
		const providerItem = activeSection.items.find(
			(i) => i.key.toLowerCase() === "image_provider",
		);
		const commonItems = activeSection.items.filter(
			(i) => i.key.toLowerCase() === "enable_image_to_image",
		);
		const imageApiItems = activeSection.items.filter(
			(i) =>
				i.key.toLowerCase().startsWith("image_") &&
				i.key.toLowerCase() !== "image_provider",
		);
		const fakeItems = activeSection.items.filter((i) =>
			i.key.toLowerCase().startsWith("fake_image_"),
		);

		return (
			<div className="space-y-6">
				<div className="flex items-center gap-2 text-sm text-info bg-info/10 px-4 py-2 rounded-lg border border-info/30">
					<InformationCircleIcon className="w-4 h-4 shrink-0" />
					<span>{tabConfig[activeTab]?.desc}</span>
				</div>

				{providerItem && (
					<div className="bg-base-200 p-4 rounded-lg border-2 border-base-content/30">
						<div className="flex items-center gap-2 mb-3">
							<span className="font-mono font-bold text-sm">IMAGE_PROVIDER</span>
							<span className="badge badge-primary badge-xs">必选</span>
						</div>
						<div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
							<label
								className={`
                flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									imageProvider === "openai"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="IMAGE_PROVIDER"
									value="openai"
									checked={imageProvider === "openai"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">OpenAI 兼容</div>
									<div className="text-xs text-base-content/60">
										可用于 gpt-image-2 等兼容接口
									</div>
								</div>
							</label>
							<label
								className={`
                flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									imageProvider === "modelscope"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="IMAGE_PROVIDER"
									value="modelscope"
									checked={imageProvider === "modelscope"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">ModelScope</div>
									<div className="text-xs text-base-content/60">
										异步图片任务，支持 Z-Image-Turbo
									</div>
								</div>
							</label>
							<label
								className={`
                flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									imageProvider === "fake"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="IMAGE_PROVIDER"
									value="fake"
									checked={imageProvider === "fake"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">Fake 本地测试</div>
									<div className="text-xs text-base-content/60">
										返回本地占位图，不调用外部图像 API
									</div>
								</div>
							</label>
						</div>
					</div>
				)}

				{(imageProvider === "modelscope" || imageProvider === "openai") &&
					imageApiItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<PhotoIcon className="w-4 h-4" />
							{imageProvider === "modelscope"
								? "ModelScope 图像接口配置"
								: "OpenAI 兼容接口配置"}
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{imageApiItems.map(renderConfigItem)}
						</div>
					</div>
				)}

				{imageProvider === "fake" && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<PhotoIcon className="w-4 h-4" />
							Fake 本地测试配置
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{fakeItems.map(renderConfigItem)}
							<p className="text-xs text-base-content/60 px-1">
								未配置固定 URL 时会返回内置 SVG 占位图。
							</p>
						</div>
					</div>
				)}

				{commonItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-base-content/70">
							<WrenchScrewdriverIcon className="w-4 h-4" />
							通用配置
						</h4>
						<div className="space-y-4 pl-4 bg-base-300/30 rounded-r-lg py-2">
							{commonItems.map(renderConfigItem)}
						</div>
					</div>
				)}
			</div>
		);
	};

	// 渲染视频服务配置（特殊处理）
	const renderVideoSection = () => {
		if (!activeSection || activeTab !== "video") return null;

		const videoProvider = getVideoProvider();

		// 分离配置项
		const providerItem = activeSection.items.find(
			(i) => i.key.toLowerCase() === "video_provider",
		);
		const commonItems = activeSection.items.filter((i) =>
			[
				"video_image_mode",
				"enable_image_to_video",
				"video_inline_local_images",
			].includes(i.key.toLowerCase()),
		);
		const openaiItems = activeSection.items.filter(
			(i) =>
				i.key.toLowerCase().startsWith("video_") &&
				![
					"video_provider",
					"video_image_mode",
					"enable_image_to_video",
					"video_inline_local_images",
				].includes(i.key.toLowerCase()),
		);
		const doubaoItems = activeSection.items.filter((i) =>
			i.key.toLowerCase().startsWith("doubao_"),
		);
		const fakeItems = activeSection.items.filter((i) =>
			i.key.toLowerCase().startsWith("fake_video_"),
		);

		return (
			<div className="space-y-6">
				{/* 分类描述 */}
				<div className="flex items-center gap-2 text-sm text-info bg-info/10 px-4 py-2 rounded-lg border border-info/30">
					<InformationCircleIcon className="w-4 h-4 shrink-0" />
					<span>{tabConfig[activeTab]?.desc}</span>
				</div>

				{/* 服务提供商选择 */}
				{providerItem && (
					<div className="bg-base-200 p-4 rounded-lg border-2 border-base-content/30">
						<div className="flex items-center gap-2 mb-3">
							<span className="font-mono font-bold text-sm">
								VIDEO_PROVIDER
							</span>
							<span className="badge badge-primary badge-xs">必选</span>
						</div>
						<div className="flex gap-4">
							<label
								className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									videoProvider === "doubao"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="VIDEO_PROVIDER"
									value="doubao"
									checked={videoProvider === "doubao"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">豆包视频</div>
									<div className="text-xs text-base-content/60">
										火山引擎 Ark API，国内推荐
									</div>
								</div>
							</label>
							<label
								className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									videoProvider === "openai"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="VIDEO_PROVIDER"
									value="openai"
									checked={videoProvider === "openai"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">OpenAI 兼容</div>
									<div className="text-xs text-base-content/60">
										支持任何 OpenAI 兼容接口
									</div>
								</div>
							</label>
							<label
								className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
									videoProvider === "fake"
										? "border-accent bg-accent/10"
										: "border-base-content/30 hover:bg-base-300"
								}
              `}
							>
								<input
									type="radio"
									name="VIDEO_PROVIDER"
									value="fake"
									checked={videoProvider === "fake"}
									onChange={handleInputChange}
									className="radio radio-accent"
								/>
								<div>
									<div className="font-bold">Fake 本地测试</div>
									<div className="text-xs text-base-content/60">
										使用本地视频素材，不调用外部视频 API
									</div>
								</div>
							</label>
						</div>
					</div>
				)}

				{/* 豆包配置 */}
				{videoProvider === "doubao" && doubaoItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<VideoCameraIcon className="w-4 h-4" />
							豆包视频配置
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{doubaoItems.map(renderConfigItem)}
						</div>
					</div>
				)}

				{/* OpenAI 兼容配置 */}
				{videoProvider === "openai" && openaiItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<VideoCameraIcon className="w-4 h-4" />
							OpenAI 兼容接口配置
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{openaiItems.map(renderConfigItem)}
						</div>
					</div>
				)}

				{/* Fake 配置 */}
				{videoProvider === "fake" && fakeItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-accent">
							<VideoCameraIcon className="w-4 h-4" />
							Fake 本地测试配置
						</h4>
						<div className="space-y-4 pl-4 bg-accent/5 rounded-r-lg py-2">
							{fakeItems.map(renderConfigItem)}
						</div>
					</div>
				)}

				{/* 通用配置 */}
				{commonItems.length > 0 && (
					<div className="space-y-4">
						<h4 className="font-bold text-sm flex items-center gap-2 text-base-content/70">
							<WrenchScrewdriverIcon className="w-4 h-4" />
							通用配置
						</h4>
						<div className="space-y-4 pl-4 bg-base-300/30 rounded-r-lg py-2">
							{commonItems.map(renderConfigItem)}
						</div>
					</div>
				)}
			</div>
		);
	};

	// 渲染普通配置项列表
	const renderNormalSection = () => {
		if (
			!activeSection ||
			activeTab === "video" ||
			activeTab === "text" ||
			activeTab === "image"
		)
			return null;

		return (
			<div className="space-y-4">
				{/* 分类描述 */}
				<div className="flex items-center gap-2 text-sm text-info bg-info/10 px-4 py-2 rounded-lg border border-info/30">
					<InformationCircleIcon className="w-4 h-4 shrink-0" />
					<span>{tabConfig[activeTab]?.desc}</span>
				</div>

				{/* 配置项列表 */}
				<div className="space-y-4">
					{activeSection.items.map(renderConfigItem)}
				</div>

				{/* 空状态 */}
				{activeSection.items.length === 0 && (
					<div className="text-center py-12 text-base-content/50">
						<InformationCircleIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
						<p>此分类暂无配置项</p>
					</div>
				)}
			</div>
		);
	};

	return (
		<div
			className="modal modal-open"
			role="dialog"
			aria-modal="true"
			aria-labelledby="settings-modal-title"
		>
			<div className="modal-box w-11/12 max-w-5xl max-h-[90vh] border-3 border-base-content/30 shadow-brutal-lg bg-base-100 p-0 flex flex-col">
				{/* 头部 */}
				<div className="flex items-center justify-between px-6 py-4 border-b-3 border-base-content/30 bg-base-200 shrink-0">
					<h3
						id="settings-modal-title"
						className="font-bold text-xl flex items-center gap-2"
					>
						<Cog6ToothIcon className="w-6 h-6 text-accent" />
						环境变量配置管理
					</h3>
					<button
						type="button"
						onClick={handleCancel}
						className="btn btn-ghost btn-circle h-11 min-h-11 w-11"
						aria-label="关闭设置"
						title="关闭设置"
					>
						<XMarkIcon className="w-5 h-5" />
					</button>
				</div>

				{isLoading && (
					<div className="flex items-center justify-center p-12">
						<span className="loading loading-spinner loading-lg"></span>
					</div>
				)}

				{isError && (
					<div className="p-6">
						<div
							role="alert"
							className="alert alert-error border-2 border-base-content/30"
						>
							<ExclamationCircleIcon className="w-6 h-6" />
							<span>加载配置失败，请检查后端服务是否正常运行。</span>
						</div>
					</div>
				)}

				{config && (
					<form
						onSubmit={handleSubmit}
						className="flex flex-col flex-1 min-h-0"
					>
						{/* 标签页导航 */}
						<div className="px-4 py-3 border-b-3 border-base-content/30 bg-base-100 shrink-0">
							<div role="tablist" className="flex flex-wrap gap-2">
								{sections.map((section) => {
									const cfg = tabConfig[section.key];
									const isActive = activeTab === section.key;
									return (
										<button
											key={section.key}
											type="button"
											role="tab"
											aria-selected={isActive}
											onClick={() => handleTabChange(section.key)}
											className={`
                        flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                        border-2 border-base-content/30 transition-all
                        ${
													isActive
														? "bg-accent text-accent-content shadow-brutal"
														: "bg-base-200 hover:bg-base-300"
												}
                      `}
										>
											{cfg?.icon}
											<span>{cfg?.title || section.title}</span>
											<span
												className={`
                        text-xs px-1.5 py-0.5 rounded
                        ${isActive ? "bg-accent-content/20" : "bg-base-300"}
                      `}
											>
												{section.items.length}
											</span>
										</button>
									);
								})}
							</div>
						</div>

						{/* 标签页内容 */}
						<div className="flex-1 overflow-y-auto p-6">
							{activeTab === "text"
								? renderTextSection()
								: activeTab === "image"
									? renderImageSection()
									: activeTab === "video"
										? renderVideoSection()
										: renderNormalSection()}
						</div>

						{/* 底部操作栏 */}
						<div className="border-t-3 border-base-content/30 bg-base-200 px-6 py-4 flex items-center gap-4 shrink-0">
							<div className="flex items-center gap-2 text-info text-sm flex-1">
								<InformationCircleIcon className="w-5 h-5 shrink-0" />
								<span>大部分配置保存后立即生效，数据库/Redis 配置需重启</span>
							</div>

							<button
								type="button"
								onClick={handleCancel}
								className="btn border-2 border-base-content/30"
							>
								取消
							</button>

							<button
								type="submit"
								className="btn btn-primary border-2 border-base-content/30"
								disabled={updateMutation.isPending}
							>
								{updateMutation.isPending && (
									<span className="loading loading-spinner loading-sm"></span>
								)}
								保存配置
							</button>
							<button
								type="button"
								className="btn btn-outline border-2 border-base-content/30"
								onClick={handleTestConnection}
								disabled={
									updateMutation.isPending ||
									isTestingConnection ||
									!getTestConnectionService()
								}
							>
								{isTestingConnection && (
									<span className="loading loading-spinner loading-sm"></span>
								)}
								测试连接
							</button>
						</div>
					</form>
				)}
			</div>

			{/* Alert Modal */}
			{alertState.show && (
				<div className="modal modal-open">
					<div className="modal-box border-3 border-base-content/30 shadow-brutal-lg">
						<div className="flex items-start gap-3">
							{/* Icon */}
							<div
								className={`shrink-0 ${
									alertState.type === "success"
										? "text-success"
										: alertState.type === "error"
											? "text-error"
											: "text-warning"
								}`}
							>
								{alertState.type === "success" ? (
									<CheckCircleIcon className="w-8 h-8" />
								) : (
									<ExclamationCircleIcon className="w-8 h-8" />
								)}
							</div>

							{/* Content */}
							<div className="flex-1">
								<h3 className="font-bold text-lg mb-2">{alertState.title}</h3>
								<p className="text-base-content/80">{alertState.message}</p>
								{alertState.details && (
									<div className="mt-3 p-3 bg-base-200 rounded-lg border-2 border-base-content/30">
										<p className="text-sm whitespace-pre-line">
											{alertState.details}
										</p>
									</div>
								)}
							</div>
						</div>

						{/* Actions */}
						<div className="modal-action">
							<button
								onClick={() => {
									setAlertState({ ...alertState, show: false });
									closeModal(); // 关闭设置模态框
								}}
								className="btn btn-primary border-2 border-base-content/30"
							>
								确定
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// 配置项详细说明
function getConfigDescription(key: string): string {
	const descriptions: Record<string, string> = {
		// 基础设置
		APP_NAME: "应用名称，用于日志和服务标识",
		ENVIRONMENT: "运行环境：dev（开发）/ staging（预发布）/ prod（生产）",
		LOG_LEVEL: "日志级别：DEBUG / INFO / WARNING / ERROR",
		API_V1_PREFIX: "API 路由前缀，默认 /api/v1",
		CORS_ORIGINS: '跨域配置，JSON 数组格式，如 ["http://localhost:3000"]',

		// 数据库
		DATABASE_URL: "PostgreSQL 数据库连接字符串（asyncpg 协议）",
		DB_ECHO: "是否在控制台打印 SQL 语句（调试用）",
		REDIS_URL: "Redis 连接字符串，用于跨进程信号共享",

		// LLM 服务
		ANTHROPIC_API_KEY: "Anthropic 官方 API 密钥",
		ANTHROPIC_AUTH_TOKEN: "中转站 Token（国内推荐使用）",
		ANTHROPIC_BASE_URL: "API 基础地址（官方或中转站地址）",
		ANTHROPIC_MODEL: "Claude 模型名称，如 claude-sonnet-4-5-20250929",

		// 文本生成服务
		TEXT_PROVIDER:
			"文本生成服务提供商：anthropic（Claude）/ openai（OpenAI 兼容）/ fake（本地测试，不调用外部 API）",
		FAKE_TEXT_RESPONSE: "Fake 文本 Provider 固定返回内容（可选）",
		TEXT_BASE_URL: "文本生成服务地址（OpenAI 兼容接口）",
		TEXT_API_KEY: "文本生成 API 密钥（OpenAI 兼容）",
		TEXT_MODEL: "文本生成模型名称（OpenAI 兼容），如 deepseek-v4-flash",
		TEXT_ENDPOINT: "文本生成 API 端点路径（OpenAI 兼容）",
		TEXT_ENABLE_THINKING:
			"是否向支持推理开关的文本模型显式传递 thinking 配置；留空表示由模型/服务默认决定。",

		// 图像服务
		IMAGE_PROVIDER:
			"图像生成服务提供商：modelscope（ModelScope 异步图片任务）/ openai（OpenAI 兼容）/ fake（本地测试，不调用外部 API）",
		IMAGE_BASE_URL:
			"图像生成服务地址；ModelScope 使用 https://api-inference.modelscope.cn，gpt-image-2 使用 https://image.6668.dpdns.org/v1",
		IMAGE_API_KEY: "图像生成 API 密钥",
		IMAGE_MODEL: "图像生成模型名称，如 gpt-image-2 或 Tongyi-MAI/Z-Image-Turbo",
		IMAGE_ENDPOINT:
			"图像生成 API 端点路径；gpt-image-2 使用 /chat/completions，ModelScope 使用 /v1/images/generations",
		ENABLE_IMAGE_TO_IMAGE: "是否启用图生图（I2I）功能",
		FAKE_IMAGE_FIXTURE_URL:
			"Fake 图像 Provider 固定返回的图片 URL（可选）；留空时使用后端内置本地 SVG 占位图，不调用外部图像 API。",
		CRITIQUE_ENABLED:
			"是否启用 Critic 质量审查闭环；开启后会审查角色图/分镜图，不达标时触发重生成。",
		CRITIQUE_SCORE_THRESHOLD:
			"Critic 质量分阈值（0-10）；低于该分数视为不达标并进入重生成逻辑。",
		CRITIQUE_MAX_ROUNDS:
			"Critic 最多重试轮数；达到上限后为避免卡死会继续后续流程。",
		OUTLINE_ENABLED:
			"是否启用故事大纲审批流程；开启后先生成大纲并等待确认，再继续角色和分镜规划。",

		// 视频服务
		VIDEO_PROVIDER:
			"视频服务提供商：openai（OpenAI 兼容）/ doubao（豆包）/ fake（本地测试）",
		VIDEO_BASE_URL: "视频生成服务地址（OpenAI 兼容接口）",
		VIDEO_API_KEY: "视频生成 API 密钥",
		VIDEO_MODEL: "视频生成模型名称",
		VIDEO_ENDPOINT: "视频生成 API 端点路径",
		VIDEO_MODE: "视频生成模式：text（文生视频）或 image（图生视频）",
		ENABLE_IMAGE_TO_VIDEO: "是否启用图生视频（I2V）功能",
		FAKE_VIDEO_FIXTURE_URL:
			"Fake 视频 Provider 固定返回的视频 URL；推荐使用 /static/videos/*.mp4，本地测试不调用外部视频 API。",
		FAKE_VIDEO_FIXTURE_PATH:
			"Fake 视频 Provider 本地素材文件路径；会复制到后端 static/videos 后返回本地 URL。",

		// 豆包视频
		DOUBAO_API_KEY: "豆包 API 密钥（火山引擎 ARK_API_KEY）",
		DOUBAO_VIDEO_MODEL: "豆包视频模型 ID",
		DOUBAO_VIDEO_DURATION: "豆包视频时长：5 或 10（秒）",
		DOUBAO_VIDEO_RATIO: "豆包视频比例：16:9 / 9:16 / 1:1 / adaptive",
		DOUBAO_GENERATE_AUDIO: "豆包视频是否生成音频",
		VIDEO_IMAGE_MODE:
			"图生视频模式：first_frame（仅首帧）/ reference（拼接参考图）",
		VIDEO_INLINE_LOCAL_IMAGES: "未配置 PUBLIC_BASE_URL 时是否内联本地图片",

		// TTS / BGM
		TTS_ENABLED: "是否启用 TTS 配音（Edge TTS）；关闭后只生成画面/视频，不合成语音。",
		TTS_DEFAULT_VOICE:
			"默认 TTS 语音名称，例如 zh-CN-XiaoxiaoNeural；用于分镜对白配音。",
		BGM_ENABLED: "是否启用背景音乐合成；关闭后最终视频不叠加 BGM。",
		BGM_VOLUME: "背景音乐音量，范围 0-1；数值越大 BGM 越响。",
		TTS_VOLUME: "TTS 人声音量，范围 0-1；数值越大对白越响。",
		BGM_DIRECTORY: "BGM 音频文件目录，相对于后端 app 目录。",

		// 思考链
		THINKING_CHAIN_ENABLED:
			"是否向前端推送 Agent 思考链/阶段说明；关闭可减少运行时消息噪音。",
		THINKING_CHAIN_DETAIL_LEVEL:
			"思考链详细级别：minimal 仅关键结论，normal 含审查阶段，verbose 展示更多规划/推理过程。",

		// 其他
		REQUEST_TIMEOUT_S: "HTTP 请求超时时间（秒）",
		PUBLIC_BASE_URL: "对外可访问的后端地址，用于生成完整 URL",
		ADMIN_TOKEN: "管理员 Token，用于配置更新权限验证",
	};

	return descriptions[key.toUpperCase()] || "暂无说明";
}
