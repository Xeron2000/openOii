import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { universesApi } from "~/services/api";
import { SharedCharacterCard } from "~/components/universe/SharedCharacterCard";
import { Card } from "~/components/ui/Card";
import {
	PlusIcon,
	BookOpenIcon,
	TrashIcon,
	GlobeAltIcon,
	PaintBrushIcon,
	UserGroupIcon,
} from "@heroicons/react/24/outline";
import { toast } from "~/utils/toast";
import type { UniverseDetail } from "~/types";

export function UniverseDetailPage() {
	const { universeId } = useParams<{ universeId: string }>();
	const queryClient = useQueryClient();
	const id = Number(universeId);

	const { data: universe, isLoading } = useQuery({
		queryKey: ["universe", id],
		queryFn: () => universesApi.get(id),
		enabled: !isNaN(id),
	});

	const removeProjectMutation = useMutation({
		mutationFn: (projectId: number) =>
			universesApi.removeProject(id, projectId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["universe", id] });
			queryClient.invalidateQueries({ queryKey: ["universes"] });
			toast.success({ title: "已移除", message: "项目已从宇宙移除" });
		},
	});

	if (isLoading) {
		return (
			<div className="min-h-screen bg-base-100 flex items-center justify-center">
				<span className="loading loading-spinner loading-lg text-primary" />
			</div>
		);
	}

	if (!universe) {
		return (
			<div className="min-h-screen bg-base-100 flex items-center justify-center">
				<p className="text-base-content/50">宇宙不存在</p>
			</div>
		);
	}

	const u = universe as UniverseDetail;
	const nextChapterNumber =
		u.chapters.length > 0
			? Math.max(...u.chapters.map((chapter) => chapter.chapter_number ?? 0)) + 1
			: 1;
	const createChapterHref = `/?universeId=${u.id}&chapterNumber=${nextChapterNumber}`;

	return (
		<div className="min-h-screen bg-base-100 font-sans">
			<header className="navbar bg-base-200 border-b border-base-300">
				<div className="flex-1">
					<Link to="/universes" className="btn btn-ghost btn-sm">
						← 返回宇宙列表
					</Link>
				</div>
				<div className="flex-1" />
			</header>

			<main className="container mx-auto px-4 py-8 max-w-6xl">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl font-heading font-bold underline-sketch">
						{u.name}
					</h1>
					{u.description && (
						<p className="text-base-content/60 mt-2">{u.description}</p>
					)}
				</div>

				{/* World setting */}
				{u.world_setting && (
					<Card className="mb-6" variant="primary">
						<h2 className="text-lg font-heading font-bold mb-2 flex items-center gap-2">
							<GlobeAltIcon className="w-5 h-5" aria-hidden="true" />
							世界观设定
						</h2>
						<p className="text-sm text-base-content/70 whitespace-pre-wrap">
							{u.world_setting}
						</p>
					</Card>
				)}

				{/* Style rules */}
				{u.style_rules && (
					<Card className="mb-6" variant="accent">
						<h2 className="text-lg font-heading font-bold mb-2 flex items-center gap-2">
							<PaintBrushIcon className="w-5 h-5" aria-hidden="true" />
							统一风格规则
						</h2>
						<p className="text-sm text-base-content/70 whitespace-pre-wrap">
							{u.style_rules}
						</p>
					</Card>
				)}

				{/* Chapters */}
				<Card className="mb-6">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-lg font-heading font-bold flex items-center gap-2">
							<BookOpenIcon className="w-5 h-5" />
							章节列表
						</h2>
						<Link
							to={createChapterHref}
							className="btn-doodle touch-target inline-flex items-center justify-center gap-1 bg-primary px-3 py-1.5 font-heading text-sm text-primary-content hover:bg-primary/90"
						>
							<PlusIcon className="w-3.5 h-3.5 mr-1" />
							新建章节
						</Link>
					</div>

					{u.chapters.length === 0 ? (
						<p className="text-sm text-base-content/40 text-center py-8">
							还没有章节，从这里新建第一个工作区。
						</p>
					) : (
						<div className="space-y-2">
							{[...u.chapters]
								.sort((a, b) =>
									(a.chapter_number ?? 999) - (b.chapter_number ?? 999),
								)
								.map((ch) => (
									<div
										key={ch.id}
										className="flex items-center justify-between p-3 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors"
									>
										<div className="flex items-center gap-3">
											<span className="badge badge-primary badge-sm font-bold">
												第{ch.chapter_number ?? "?"}章
											</span>
											<Link
												to={`/project/${ch.project_id}`}
												className="font-heading font-bold text-sm hover:text-primary transition-colors"
											>
												{ch.chapter_title || ch.project_title || "未命名"}
											</Link>
											{!ch.is_main_story && (
												<span className="badge badge-ghost badge-xs">外传</span>
											)}
										</div>
										<button
											type="button"
											className="btn btn-ghost btn-xs text-error/50 hover:text-error"
											aria-label={`从宇宙移除${ch.chapter_title || ch.project_title || "未命名项目"}`}
											title="从宇宙移除"
											onClick={() => removeProjectMutation.mutate(ch.project_id)}
										>
											<TrashIcon className="w-3.5 h-3.5" />
										</button>
									</div>
								))}
						</div>
					)}
				</Card>

				{/* Shared Characters */}
				<Card>
					<h2 className="text-lg font-heading font-bold mb-4 flex items-center gap-2">
						<UserGroupIcon className="w-5 h-5" aria-hidden="true" />
						共享角色库
					</h2>

					{u.shared_characters.length === 0 ? (
						<p className="text-sm text-base-content/40 text-center py-8">
							还没有共享角色，从项目角色中提升
						</p>
					) : (
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
							{u.shared_characters.map((sc) => (
								<SharedCharacterCard key={sc.id} character={sc} />
							))}
						</div>
					)}
				</Card>
			</main>
		</div>
	);
}
