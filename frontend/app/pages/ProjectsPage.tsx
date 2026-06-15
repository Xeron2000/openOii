import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowPathIcon,
	DocumentTextIcon,
	FaceFrownIcon,
	FolderOpenIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import { TopBar } from "~/components/layout/TopBar";
import { ConfirmModal } from "~/components/ui/ConfirmModal";
import { projectsApi } from "~/services/api";
import { cleanupDeletedProjectCaches } from "~/features/projects/deleteProject";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";
import type { Project } from "~/types";

const STATUS_META: Record<string, { label: string; cls: string }> = {
	active: {
		label: "进行中",
		cls: "border-info/35 bg-info/10 text-base-content",
	},
	draft: {
		label: "草稿",
		cls: "border-base-content/20 bg-base-200 text-base-content",
	},
	failed: {
		label: "失败",
		cls: "border-error/35 bg-error/10 text-base-content",
	},
	planning: {
		label: "规划中",
		cls: "border-warning/35 bg-warning/10 text-base-content",
	},
	processing: {
		label: "生成中",
		cls: "border-warning/35 bg-warning/10 text-base-content",
	},
	ready: {
		label: "成片可用",
		cls: "border-success/35 bg-success/10 text-base-content",
	},
	superseded: {
		label: "需重合成",
		cls: "border-warning/35 bg-warning/10 text-base-content",
	},
};

function projectStatusMeta(status: string) {
	return (
		STATUS_META[status] ?? {
			label: status,
			cls: "border-base-content/20 bg-base-200 text-base-content",
		}
	);
}

function formatDate(value: string | null | undefined) {
	if (!value) return "未知";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "未知";
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function errorMessage(error: unknown, fallback: string) {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error) return error.message;
	return fallback;
}

export function ProjectsPage() {
	const queryClient = useQueryClient();
	const [deleteTarget, setDeleteTarget] = useState<number[] | null>(null);
	const [selectedIds, setSelectedIds] = useState<number[]>([]);

	const {
		data: projects,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["projects"],
		queryFn: projectsApi.list,
		retry: 1,
	});

	const visibleProjects = projects ?? [];
	const completedCount = useMemo(
		() => visibleProjects.filter((project) => project.status === "ready").length,
		[visibleProjects],
	);
	const selectedCount = selectedIds.length;
	const allSelected =
		visibleProjects.length > 0 && selectedCount === visibleProjects.length;

	useEffect(() => {
		if (!error) return;
		toast.error({
			title: "加载项目列表失败",
			message: errorMessage(error, "无法获取项目列表"),
			actions: [
				{
					label: "重试",
					onClick: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
				},
			],
		});
	}, [error, queryClient]);

	useEffect(() => {
		if (!projects) return;
		const ids = new Set(projects.map((project) => project.id));
		setSelectedIds((current) => current.filter((id) => ids.has(id)));
	}, [projects]);

	const deleteMutation = useMutation({
		mutationFn: (ids: number[]) => projectsApi.deleteMany(ids),
		onSuccess: (_, deletedIds) => {
			cleanupDeletedProjectCaches(queryClient, deletedIds);
			setSelectedIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
			setDeleteTarget(null);
			toast.success({
				title: "删除成功",
				message: deletedIds.length > 1 ? "项目已批量删除" : "项目已删除",
			});
		},
		onError: (error: Error | ApiError) => {
			toast.error({
				title: "删除失败",
				message: errorMessage(error, "未知错误"),
			});
		},
	});

	const handleDeleteClick = (id: number) => {
		if (deleteMutation.isPending) return;
		setDeleteTarget([id]);
	};

	const handleBatchDeleteClick = () => {
		if (deleteMutation.isPending || selectedCount === 0) return;
		setDeleteTarget([...selectedIds]);
	};

	const handleToggleSelect = (projectId: number, checked: boolean) => {
		setSelectedIds((prev) =>
			checked
				? Array.from(new Set([...prev, projectId]))
				: prev.filter((id) => id !== projectId),
		);
	};

	const handleToggleSelectAll = (checked: boolean) => {
		setSelectedIds(checked ? visibleProjects.map((project) => project.id) : []);
	};

	const handleConfirmDelete = () => {
		if (deleteTarget && deleteTarget.length > 0) {
			deleteMutation.mutate(deleteTarget);
		}
	};

	return (
		<div className="min-h-screen bg-base-100 font-sans text-base-content">
			<TopBar />

			<main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
				<header className="flex flex-col gap-4 border-b-2 border-base-content/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
					<div className="min-w-0">
						<p className="m-0 text-[10px] font-mono uppercase tracking-wide text-base-content/75">
							project browser
						</p>
						<h1 className="m-0 mt-1 font-heading text-3xl font-bold">
							项目
						</h1>
						<p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-base-content/75">
							从这里回到任意漫剧工作台，或清理不再需要的草稿。
						</p>
					</div>

					<div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
						<Metric label="全部" value={visibleProjects.length} />
						<Metric label="成片" value={completedCount} />
						<Metric label="已选" value={selectedCount} />
						<Link
							to="/"
							className="btn-doodle touch-target col-span-3 inline-flex items-center justify-center gap-2 bg-primary px-4 py-2 text-sm font-heading text-primary-content sm:col-span-1"
						>
							<PlusIcon className="h-4 w-4" aria-hidden="true" />
							新建项目
						</Link>
					</div>
				</header>

				<section
					className="rounded-xl border-2 border-base-content/15 bg-base-200/45"
					aria-label="项目批量操作"
				>
					<div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
						<label className="flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-lg px-2 text-sm font-semibold text-base-content/70">
							<input
								type="checkbox"
								checked={allSelected}
								onChange={(event) => handleToggleSelectAll(event.target.checked)}
								disabled={visibleProjects.length === 0}
								className="checkbox checkbox-sm"
							/>
							<span>全选</span>
						</label>
						<div className="flex flex-wrap items-center gap-2">
							<span className="rounded-full border border-base-content/15 bg-base-100 px-3 py-1 text-xs font-semibold text-base-content/75">
								{selectedCount > 0
									? `已选择 ${selectedCount} 个项目`
									: "未选择项目"}
							</span>
							<button
								type="button"
								className="btn btn-sm btn-error min-h-11 gap-2"
								onClick={handleBatchDeleteClick}
								disabled={selectedCount === 0 || deleteMutation.isPending}
							>
								<TrashIcon className="h-4 w-4" aria-hidden="true" />
								批量删除（{selectedCount}）
							</button>
						</div>
					</div>
				</section>

				<section className="min-h-[28rem]" aria-label="项目列表">
					{isLoading ? (
						<LoadingState />
					) : error ? (
						<ErrorState />
					) : visibleProjects.length === 0 ? (
						<EmptyState />
					) : (
						<div className="overflow-hidden rounded-xl border-2 border-base-content/15 bg-base-100 shadow-brutal-sm">
							<div className="grid grid-cols-[44px_minmax(0,1fr)_120px_120px_64px] gap-3 border-b border-base-content/10 bg-base-200/65 px-4 py-2 text-xs font-mono uppercase text-base-content/75">
								<span />
								<span>项目</span>
								<span>状态</span>
								<span>更新</span>
								<span className="text-right">操作</span>
							</div>
							<div className="divide-y divide-base-content/10">
								{visibleProjects.map((project) => (
									<ProjectRow
										key={project.id}
										project={project}
										selected={selectedIds.includes(project.id)}
										onSelectedChange={(checked) =>
											handleToggleSelect(project.id, checked)
										}
										onDelete={() => handleDeleteClick(project.id)}
									/>
								))}
							</div>
						</div>
					)}
				</section>
			</main>

			<ConfirmModal
				isOpen={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				onConfirm={handleConfirmDelete}
				title="删除项目"
				message={`确定要删除选中的${deleteTarget ? deleteTarget.length : 0}个项目吗？删除后将无法恢复。`}
				confirmText="删除"
				cancelText="取消"
				variant="danger"
				isLoading={deleteMutation.isPending}
			/>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border border-base-content/10 bg-base-200 px-3 py-2">
			<p className="m-0 text-[10px] font-mono uppercase text-base-content/75">
				{label}
			</p>
			<p className="m-0 font-heading text-lg font-bold leading-none">{value}</p>
		</div>
	);
}

function ProjectRow({
	project,
	selected,
	onSelectedChange,
	onDelete,
}: {
	project: Project;
	selected: boolean;
	onSelectedChange: (checked: boolean) => void;
	onDelete: () => void;
}) {
	const status = projectStatusMeta(project.status);
	const story = project.story?.trim();

	return (
		<article className="grid min-h-20 grid-cols-[44px_minmax(0,1fr)_120px_120px_64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-base-200/45">
			<label className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-base-200">
				<input
					type="checkbox"
					aria-label={`选择项目 ${project.title}`}
					checked={selected}
					onChange={(event) => onSelectedChange(event.target.checked)}
					className="checkbox checkbox-sm"
				/>
			</label>

			<Link
				to={`/project/${project.id}`}
				className="min-w-0 rounded-lg py-1 pr-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
			>
				<div className="flex min-w-0 items-center gap-2">
					<FolderOpenIcon
						className="h-4 w-4 shrink-0 text-primary"
						aria-hidden="true"
					/>
					<h2 className="m-0 truncate font-heading text-base font-bold">
						{project.title}
					</h2>
				</div>
				<p className="m-0 mt-1 truncate text-sm text-base-content/75">
					{story || "尚未填写故事内容"}
				</p>
				<div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-base-content/75">
					<span>{project.style || "未设风格"}</span>
					<span>{project.target_shot_count ?? "自动"} 镜头</span>
					{project.creation_mode ? <span>{project.creation_mode}</span> : null}
				</div>
			</Link>

			<span
				className={`inline-flex min-h-8 items-center justify-center rounded-full border px-3 text-xs font-bold ${status.cls}`}
			>
				{status.label}
			</span>

			<span className="font-mono text-xs text-base-content/75">
				{formatDate(project.updated_at)}
			</span>

			<button
				type="button"
				className="btn btn-ghost btn-sm btn-square justify-self-end text-error hover:bg-error/10"
				onClick={onDelete}
				aria-label={`删除项目 ${project.title}`}
				title="删除"
			>
				<TrashIcon className="h-5 w-5" aria-hidden="true" />
			</button>
		</article>
	);
}

function LoadingState() {
	return (
		<div className="flex min-h-[28rem] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-base-content/15 bg-base-200/35">
			<ArrowPathIcon
				className="h-6 w-6 animate-spin text-primary"
				aria-hidden="true"
			/>
			<p className="m-0 text-sm font-semibold text-base-content/75">
				正在加载项目...
			</p>
		</div>
	);
}

function ErrorState() {
	return (
		<div className="flex min-h-[28rem] flex-col items-center justify-center gap-3 rounded-xl border-2 border-error/25 bg-error/5 text-center">
			<FaceFrownIcon className="h-7 w-7 text-error" aria-hidden="true" />
			<div>
				<p className="m-0 font-heading text-lg font-bold text-error">
					加载项目失败，请重试。
				</p>
				<p className="m-0 mt-1 text-sm text-base-content/75">
					可以使用右上角刷新浏览器，或等待后端恢复。
				</p>
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="flex min-h-[28rem] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-base-content/15 bg-base-200/35 text-center">
			<span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-content shadow-brutal-sm">
				<DocumentTextIcon className="h-6 w-6" aria-hidden="true" />
			</span>
			<div>
				<p className="m-0 font-heading text-xl font-bold">暂无项目</p>
				<p className="m-0 mt-1 text-sm text-base-content/75">
					开始创作你的第一个故事吧！
				</p>
			</div>
			<Link
				to="/"
				className="btn-doodle touch-target inline-flex items-center justify-center gap-2 bg-primary px-4 py-2 text-sm font-heading text-primary-content"
			>
				<PlusIcon className="h-4 w-4" aria-hidden="true" />
				新建项目
			</Link>
		</div>
	);
}
