import { useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChatPanel } from "~/components/chat/ChatPanel";
import { Button } from "~/components/ui/Button";
import { SvgIcon, type IconName } from "~/components/ui/SvgIcon";
import { assetsApi, getStaticUrl } from "~/services/api";
import type { Asset } from "~/types";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";
import type { ComicWorkflowNode } from "../graph/types";
import { WorkflowInspector } from "../inspector/WorkflowInspector";

export type WorkspaceSidebarTab = "chat" | "inspector" | "assets";

interface WorkspaceSidebarProps {
	activeTab: WorkspaceSidebarTab;
	onTabChange: (tab: WorkspaceSidebarTab) => void;
	projectId: number;
	selectedNode: ComicWorkflowNode | null;
	structureLocked: boolean;
	onSendFeedback: (content: string) => void;
	onConfirm: (feedback?: string) => void;
	onCancel: () => void;
	isGenerating: boolean;
	collapsed?: boolean;
	onCollapsedChange?: (collapsed: boolean) => void;
}

const TABS: Array<{
	key: WorkspaceSidebarTab;
	label: string;
	icon: IconName;
}> = [
	{ key: "chat", label: "对话", icon: "book-open" },
	{ key: "inspector", label: "属性", icon: "layers" },
	{ key: "assets", label: "资产", icon: "archive" },
];

function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error) return error.message;
	return fallback;
}

function tabId(tab: WorkspaceSidebarTab): string {
	return `workspace-tab-${tab}`;
}

function panelId(tab: WorkspaceSidebarTab): string {
	return `workspace-panel-${tab}`;
}

export function WorkspaceSidebar({
	activeTab,
	onTabChange,
	projectId,
	selectedNode,
	structureLocked,
	onSendFeedback,
	onConfirm,
	onCancel,
	isGenerating,
	collapsed = false,
	onCollapsedChange,
}: WorkspaceSidebarProps) {
	const tabRefs = useRef<Record<WorkspaceSidebarTab, HTMLButtonElement | null>>({
		chat: null,
		inspector: null,
		assets: null,
	});

	const selectTab = (tab: WorkspaceSidebarTab) => {
		onTabChange(tab);
		onCollapsedChange?.(false);
	};

	const focusTab = (tab: WorkspaceSidebarTab) => {
		onTabChange(tab);
		tabRefs.current[tab]?.focus();
	};

	const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const currentIndex = TABS.findIndex((tab) => tab.key === activeTab);
		if (currentIndex < 0) return;

		const keyHandlers: Record<string, () => void> = {
			ArrowRight: () =>
				focusTab(TABS[(currentIndex + 1) % TABS.length].key),
			ArrowDown: () =>
				focusTab(TABS[(currentIndex + 1) % TABS.length].key),
			ArrowLeft: () =>
				focusTab(TABS[(currentIndex - 1 + TABS.length) % TABS.length].key),
			ArrowUp: () =>
				focusTab(TABS[(currentIndex - 1 + TABS.length) % TABS.length].key),
			Home: () => focusTab(TABS[0].key),
			End: () => focusTab(TABS[TABS.length - 1].key),
		};

		const handler = keyHandlers[event.key];
		if (!handler) return;
		event.preventDefault();
		handler();
	};

	return (
		<aside
			className={clsx(
				"absolute right-0 z-30 flex shrink-0 flex-col border-base-content/15 bg-base-100 shadow-brutal transition-all duration-200 lg:relative lg:inset-auto lg:h-full lg:border-l-2 lg:shadow-none",
				collapsed
					? "inset-y-0 h-full w-14 border-l-2"
					: "inset-x-2 bottom-2 top-auto h-[min(70vh,620px)] rounded-xl border-2 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[360px] lg:rounded-none lg:border-y-0 lg:border-r-0",
			)}
			aria-label="工作区"
		>
			<div
				className={clsx(
					"grid gap-1 border-b border-base-content/10 p-1",
					collapsed ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_44px]",
				)}
			>
				<div
					className={clsx("grid gap-1", collapsed ? "grid-cols-1" : "grid-cols-3")}
					role="tablist"
					aria-label="工作区面板"
					aria-orientation={collapsed ? "vertical" : "horizontal"}
					onKeyDown={handleTabKeyDown}
				>
					{TABS.map((tab) => (
						<button
							key={tab.key}
							type="button"
							ref={(node) => {
								tabRefs.current[tab.key] = node;
							}}
							id={tabId(tab.key)}
							className={clsx(
								"flex h-11 items-center justify-center gap-1 rounded-md text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50",
								activeTab === tab.key
									? "bg-primary text-primary-content"
									: "text-base-content/70 hover:bg-base-200",
							)}
							onClick={() => selectTab(tab.key)}
							aria-label={tab.label}
							title={tab.label}
							role="tab"
							aria-selected={activeTab === tab.key}
							aria-controls={panelId(tab.key)}
							tabIndex={activeTab === tab.key ? 0 : -1}
						>
							<SvgIcon name={tab.icon} size={13} />
							<span className={collapsed ? "sr-only" : ""}>{tab.label}</span>
						</button>
					))}
				</div>
				<button
					type="button"
					className="flex h-11 items-center justify-center rounded-md text-base-content/55 transition-colors hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary/50"
					onClick={() => onCollapsedChange?.(!collapsed)}
					aria-label={collapsed ? "展开工作区" : "收起工作区"}
					title={collapsed ? "展开工作区" : "收起工作区"}
				>
					<SvgIcon
						name="chevron-right"
						size={15}
						className={collapsed ? "rotate-180" : ""}
					/>
				</button>
			</div>

			<div
				id={panelId(activeTab)}
				className={clsx("min-h-0 flex-1 overflow-hidden", collapsed && "hidden")}
				role="tabpanel"
				aria-labelledby={tabId(activeTab)}
				tabIndex={0}
			>
				{activeTab === "chat" ? (
					<ChatPanel
						onSendFeedback={onSendFeedback}
						onConfirm={onConfirm}
						onCancel={onCancel}
						isGenerating={isGenerating}
					/>
				) : null}
				{activeTab === "inspector" ? (
					<WorkflowInspector
						projectId={projectId}
						selectedNode={selectedNode}
						structureLocked={structureLocked}
					/>
				) : null}
				{activeTab === "assets" ? (
					<AssetsPanel projectId={projectId} active={activeTab === "assets"} />
				) : null}
			</div>
		</aside>
	);
}

function AssetsPanel({ projectId, active }: { projectId: number; active: boolean }) {
	const queryClient = useQueryClient();
	const [assetType, setAssetType] = useState<"all" | "character" | "scene">("all");
	const [search, setSearch] = useState("");
	const filterType = assetType === "all" ? undefined : assetType;

	const { data, isLoading } = useQuery({
		queryKey: ["assets", filterType, search],
		queryFn: () => assetsApi.list({ assetType: filterType, search: search || undefined }),
		enabled: active,
	});

	const useAssetMutation = useMutation({
		mutationFn: (asset: Asset) => assetsApi.useInProject(asset.id, projectId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["characters", projectId] });
			queryClient.invalidateQueries({ queryKey: ["shots", projectId] });
			toast.success({ title: "资产库", message: "已添加到当前项目" });
		},
		onError: (error) =>
			toast.error({
				title: "资产库",
				message: errorMessage(error, "添加失败"),
			}),
	});

	const deleteAssetMutation = useMutation({
		mutationFn: (id: number) => assetsApi.delete(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["assets"] });
			toast.success({ title: "资产库", message: "已删除" });
		},
		onError: (error) =>
			toast.error({
				title: "资产库",
				message: errorMessage(error, "删除失败"),
			}),
	});

	const items = data?.items ?? [];

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="border-b border-base-content/10 p-3">
				<div className="mb-2 flex items-center justify-between gap-2">
					<h2 className="m-0 font-heading text-base font-bold">资产库</h2>
					<span className="badge badge-ghost badge-sm">{data?.total ?? 0}</span>
				</div>
				<input
					id="workspace-asset-search"
					name="assetSearch"
					className="input input-bordered input-sm w-full bg-base-100"
					placeholder="搜索资产"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				<div className="mt-2 grid grid-cols-3 gap-1">
					{(["all", "character", "scene"] as const).map((type) => (
						<button
							key={type}
							type="button"
							className={`h-11 rounded-md text-xs font-semibold ${
								assetType === type
									? "bg-primary text-primary-content"
									: "bg-base-200 text-base-content/60"
							}`}
							onClick={() => setAssetType(type)}
						>
							{assetTypeLabel(type)}
						</button>
					))}
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{isLoading ? (
					<div className="flex h-32 items-center justify-center">
						<span className="loading loading-spinner loading-sm text-primary" />
					</div>
				) : items.length === 0 ? (
					<div className="py-10 text-center text-sm text-base-content/40">
						<SvgIcon name="archive" size={24} className="mx-auto mb-2 opacity-40" />
						<p className="m-0">暂无资产</p>
					</div>
				) : (
					<div className="grid grid-cols-2 gap-2">
						{items.map((asset) => (
							<AssetTile
								key={asset.id}
								asset={asset}
								onUse={() => useAssetMutation.mutate(asset)}
								onDelete={() => deleteAssetMutation.mutate(asset.id)}
								busy={useAssetMutation.isPending || deleteAssetMutation.isPending}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function AssetTile({
	asset,
	busy,
	onUse,
	onDelete,
}: {
	asset: Asset;
	busy: boolean;
	onUse: () => void;
	onDelete: () => void;
}) {
	const imageUrl = getStaticUrl(asset.image_url);
	return (
		<div className="overflow-hidden rounded-lg border-2 border-base-content/10 bg-base-200/50">
			<div className="aspect-[4/3] bg-base-300">
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={asset.name}
						className="h-full w-full object-cover"
						loading="lazy"
					/>
				) : (
					<div className="flex h-full items-center justify-center text-base-content/25">
						<SvgIcon name="image" size={24} />
					</div>
				)}
			</div>
			<div className="p-2">
				<div className="flex items-center gap-1">
					<span className="badge badge-xs badge-outline">
						{asset.asset_type === "character" ? "角色" : "场景"}
					</span>
					<h3 className="m-0 min-w-0 flex-1 truncate text-xs font-bold">
						{asset.name}
					</h3>
				</div>
				<div className="mt-2 flex justify-end gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="gap-1 text-xs"
						disabled={busy}
						onClick={onUse}
					>
						<SvgIcon name="plus" size={12} />
						使用
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-error"
						disabled={busy}
						onClick={onDelete}
						aria-label="删除资产"
					>
						<SvgIcon name="trash-2" size={12} />
					</Button>
				</div>
			</div>
		</div>
	);
}

function assetTypeLabel(type: "all" | "character" | "scene"): string {
	if (type === "all") return "全部";
	if (type === "character") return "角色";
	return "场景";
}
