import { useCallback, useState, type ReactNode } from "react";
import { track, useEditor } from "tldraw";
import {
	ArrowDownTrayIcon,
	ArrowsPointingOutIcon,
	CursorArrowRaysIcon,
	HandRaisedIcon,
	MagnifyingGlassMinusIcon,
	MagnifyingGlassPlusIcon,
	Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { exportApi, getStaticUrl, projectsApi } from "~/services/api";
import { toast } from "~/utils/toast";
import type { ExportResponse } from "~/types";

interface ComicCanvasToolbarProps {
	projectId: number;
	onResetLayout: () => void;
	sortMode?: boolean;
	sortDisabled?: boolean;
	onToggleSortMode?: () => void;
	fillDisabled?: boolean;
}

export const ComicCanvasToolbar = track(function ComicCanvasToolbar({
	projectId,
	onResetLayout,
	sortMode = false,
	sortDisabled = false,
	onToggleSortMode,
	fillDisabled = false,
}: ComicCanvasToolbarProps) {
	const editor = useEditor();
	const currentTool = editor.getCurrentToolId();
	const zoomPercent = Math.round(editor.getZoomLevel() * 100);
	const [exporting, setExporting] = useState(false);
	const [filling, setFilling] = useState(false);

	const handleZoomIn = useCallback(() => {
		editor.zoomIn(editor.getViewportScreenCenter(), {
			animation: { duration: 180 },
		});
	}, [editor]);

	const handleZoomOut = useCallback(() => {
		editor.zoomOut(editor.getViewportScreenCenter(), {
			animation: { duration: 180 },
		});
	}, [editor]);

	const handleZoomReset = useCallback(() => {
		editor.resetZoom(editor.getViewportScreenCenter(), {
			animation: { duration: 180 },
		});
	}, [editor]);

	const handleZoomToFit = useCallback(() => {
		editor.zoomToFit({ animation: { duration: 260 } });
	}, [editor]);

	const pollExportStatus = useCallback(
		async (exportId: string): Promise<ExportResponse> => {
			const response = await exportApi.getStatus(projectId, exportId);
			if (response.status !== "processing") return response;
			await new Promise((resolve) => setTimeout(resolve, 2000));
			return pollExportStatus(exportId);
		},
		[projectId],
	);

	const handleFillEmpty = useCallback(
		async (type: "image" | "video") => {
			if (fillDisabled || filling) return;
			setFilling(true);
			try {
				await projectsApi.fillEmptyShots(projectId, type);
				toast.success({
					title: type === "image" ? "补齐空格 · 首帧" : "补齐空格 · 视频",
					message: "已启动，仅生成缺少产物的分镜格",
				});
			} catch (error) {
				toast.error({
					title: "补齐失败",
					message: error instanceof Error ? error.message : "请稍后重试",
				});
			} finally {
				setFilling(false);
			}
		},
		[fillDisabled, filling, projectId],
	);

	const handleExportWebtoon = useCallback(
		async () => {
			const label = "Webtoon 长图";
			setExporting(true);

			try {
				toast.info({
					title: "导出中",
					message: `正在生成${label}，请稍候`,
					duration: 5000,
				});

				const started = await exportApi.triggerWebtoon(projectId);
				const completed = await pollExportStatus(started.export_id);

				if (completed.status === "completed" && completed.download_url) {
					const url = getStaticUrl(completed.download_url);
					toast.success({
						title: "导出完成",
						message: `${label}已生成`,
						duration: 8000,
						actions: url
							? [
									{
										label: "下载",
										onClick: () => window.open(url, "_blank"),
										variant: "primary",
									},
								]
							: undefined,
					});
					return;
				}

				toast.error({
					title: "导出失败",
					message: `${label}生成失败，请重试`,
				});
			} catch (error) {
				toast.error({
					title: "导出失败",
					message: error instanceof Error ? error.message : "未知错误",
				});
			} finally {
				setExporting(false);
			}
		},
		[pollExportStatus, projectId],
	);

	return (
		<div
			className="absolute bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border-3 border-base-content/25 bg-base-100 p-1.5 text-base-content shadow-comic sm:bottom-4 sm:max-w-none sm:flex-nowrap"
			role="toolbar"
			aria-label="画布工具栏"
		>
			<ToolButton
				active={currentTool === "select"}
				label="选择工具"
				onClick={() => editor.setCurrentTool("select")}
			>
				<CursorArrowRaysIcon className="h-5 w-5" />
			</ToolButton>
			<ToolButton
				active={currentTool === "hand"}
				label="抓手工具"
				onClick={() => editor.setCurrentTool("hand")}
			>
				<HandRaisedIcon className="h-5 w-5" />
			</ToolButton>

			<Divider />

			<ToolButton label="缩小" onClick={handleZoomOut}>
				<MagnifyingGlassMinusIcon className="h-5 w-5" />
			</ToolButton>
			<button
				type="button"
				className="btn btn-sm btn-ghost h-11 min-h-11 min-w-[68px] font-mono text-sm"
				onClick={handleZoomReset}
				aria-label={`${zoomPercent}%，重置缩放`}
				title="重置缩放"
			>
				{zoomPercent}%
			</button>
			<ToolButton label="放大" onClick={handleZoomIn}>
				<MagnifyingGlassPlusIcon className="h-5 w-5" />
			</ToolButton>
			<ToolButton label="适应视图" onClick={handleZoomToFit}>
				<ArrowsPointingOutIcon className="h-5 w-5" />
			</ToolButton>

			<Divider />

			<ToolButton label="整理画布" showLabel labelText="整理" onClick={onResetLayout}>
				<Squares2X2Icon className="h-5 w-5" />
			</ToolButton>
			{onToggleSortMode ? (
				<ToolButton
					active={sortMode}
					disabled={sortDisabled}
					label={sortMode ? "完成分镜排序" : "排序九宫格"}
					showLabel
					labelText={sortMode ? "完成排序" : "排序"}
					onClick={onToggleSortMode}
				>
					<span className="font-mono text-[10px] font-bold">3×N</span>
				</ToolButton>
			) : null}
			<ToolButton
				disabled={fillDisabled || filling}
				label="补齐空格 · 首帧"
				showLabel
				labelText={filling ? "补齐中" : "补图"}
				onClick={() => handleFillEmpty("image")}
			>
				<span className="font-mono text-[10px] font-bold">图</span>
			</ToolButton>
			<ToolButton
				disabled={fillDisabled || filling}
				label="补齐空格 · 视频"
				showLabel
				labelText={filling ? "补齐中" : "补视"}
				onClick={() => handleFillEmpty("video")}
			>
				<span className="font-mono text-[10px] font-bold">视</span>
			</ToolButton>

			<Divider />

			<ToolButton
				disabled={exporting}
				label="导出 Webtoon 长图"
				showLabel
				labelText="导出"
				onClick={handleExportWebtoon}
			>
				{exporting ? (
					<span className="loading loading-spinner loading-xs" />
				) : (
					<ArrowDownTrayIcon className="h-5 w-5" />
				)}
			</ToolButton>
		</div>
	);
});

function Divider() {
	return <div className="mx-1 h-6 w-px bg-base-content/20" />;
}

function ToolButton({
	active,
	disabled,
	label,
	labelText,
	onClick,
	showLabel,
	children,
}: {
	active?: boolean;
	disabled?: boolean;
	label: string;
	labelText?: string;
	onClick: () => void;
	showLabel?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="tooltip tooltip-top" data-tip={label}>
			<button
				type="button"
				className={`btn btn-sm h-11 min-h-11 ${
					showLabel ? "min-w-0 gap-2 px-3" : "btn-square w-11"
				} ${
					active ? "btn-primary" : "btn-ghost text-base-content"
				}`}
				disabled={disabled}
				onClick={onClick}
				aria-label={label}
				title={label}
			>
				{children}
				{showLabel ? (
					<span className="whitespace-nowrap font-heading text-xs font-semibold">
						{labelText ?? label}
					</span>
				) : null}
			</button>
		</div>
	);
}
