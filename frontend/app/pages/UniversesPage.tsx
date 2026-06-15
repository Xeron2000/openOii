import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { universesApi } from "~/services/api";
import { UniverseCard } from "~/components/universe/UniverseCard";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { Modal } from "~/components/ui/Modal";
import { GlobeAltIcon, PlusIcon } from "@heroicons/react/24/outline";
import { toast } from "~/utils/toast";
import type { Universe } from "~/types";
import { Link } from "react-router-dom";

export function UniversesPage() {
	const queryClient = useQueryClient();
	const [showCreate, setShowCreate] = useState(false);
	const [createForm, setCreateForm] = useState({
		name: "",
		description: "",
		world_setting: "",
		style_rules: "",
	});

	const { data: universes = [], isLoading } = useQuery({
		queryKey: ["universes"],
		queryFn: () => universesApi.list(),
	});

	const createMutation = useMutation({
		mutationFn: universesApi.create,
		onSuccess: (universe: Universe) => {
			queryClient.invalidateQueries({ queryKey: ["universes"] });
			setShowCreate(false);
			setCreateForm({ name: "", description: "", world_setting: "", style_rules: "" });
			toast.success({
				title: "创建成功",
				message: `宇宙「${universe.name}」已创建`,
			});
		},
		onError: (error: Error) => {
			toast.error({
				title: "创建失败",
				message: error.message || "未知错误",
			});
		},
	});

	const handleCreate = () => {
		if (!createForm.name.trim()) return;
		createMutation.mutate({
			name: createForm.name.trim(),
			description: createForm.description || null,
			world_setting: createForm.world_setting || null,
			style_rules: createForm.style_rules || null,
		});
	};

	return (
		<div className="min-h-screen bg-base-100 font-sans">
			<header className="navbar bg-base-200 border-b border-base-300">
				<div className="flex-1">
					<Link to="/" className="btn btn-ghost">
						← 返回首页
					</Link>
				</div>
				<div className="font-comic text-lg text-base-content font-bold tracking-wider">
					<span className="inline-flex items-center gap-2">
						<GlobeAltIcon className="w-5 h-5" aria-hidden="true" />
						IP 宇宙
					</span>
				</div>
				<div className="flex-1" />
			</header>

			<main className="container mx-auto px-4 py-8 max-w-6xl">
				{/* Header */}
				<div className="flex items-center justify-between mb-8">
					<div>
						<h1 className="text-3xl font-heading font-bold underline-sketch">
							IP 宇宙
						</h1>
						<p className="text-sm text-base-content/70 mt-1">
							管理跨项目的共享世界观和角色库
						</p>
					</div>
					<Button onClick={() => setShowCreate(true)}>
						<PlusIcon className="w-4 h-4 mr-1" />
						创建宇宙
					</Button>
				</div>

				{/* Loading */}
				{isLoading && (
					<div className="flex items-center justify-center py-20">
						<span className="loading loading-spinner loading-lg text-primary" />
					</div>
				)}

				{/* Empty state */}
				{!isLoading && universes.length === 0 && (
					<Card className="text-center py-16">
						<GlobeAltIcon
							className="w-16 h-16 mx-auto mb-4 text-primary/70"
							aria-hidden="true"
						/>
						<h2 className="text-xl font-heading font-bold mb-2">
							还没有 IP 宇宙
						</h2>
						<p className="text-sm text-base-content/70 mb-6">
							创建你的第一个 IP 宇宙，开始构建跨项目的故事世界
						</p>
						<Button onClick={() => setShowCreate(true)}>
							<PlusIcon className="w-4 h-4 mr-1" />
							创建第一个宇宙
						</Button>
					</Card>
				)}

				{/* Universe grid */}
				{!isLoading && universes.length > 0 && (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{universes.map((u) => (
							<UniverseCard key={u.id} universe={u} />
						))}
					</div>
				)}
			</main>

			{/* Create modal */}
			{showCreate && (
				<Modal
					isOpen={showCreate}
					onClose={() => setShowCreate(false)}
					title="创建 IP 宇宙"
				>
					<div className="space-y-4">
						<Input
							label="宇宙名称"
							name="universe-name"
							placeholder="如：赛博修仙录"
							value={createForm.name}
							onChange={(e) =>
								setCreateForm({ ...createForm, name: e.target.value })
							}
						/>

						<div>
							<label htmlFor="universe-description" className="label text-xs font-bold">
								简介
							</label>
							<textarea
								id="universe-description"
								name="universe-description"
								className="textarea textarea-bordered bg-base-200 w-full h-20 text-sm"
								placeholder="宇宙的简要描述..."
								value={createForm.description}
								onChange={(e) =>
									setCreateForm({ ...createForm, description: e.target.value })
								}
							/>
						</div>

						<div>
							<label htmlFor="universe-world-setting" className="label text-xs font-bold">
								世界观设定
							</label>
							<textarea
								id="universe-world-setting"
								name="universe-world-setting"
								className="textarea textarea-bordered bg-base-200 w-full h-24 text-sm"
								placeholder="统一的世界观设定，所有章节必须遵循..."
								value={createForm.world_setting}
								onChange={(e) =>
									setCreateForm({ ...createForm, world_setting: e.target.value })
								}
							/>
						</div>

						<div>
							<label htmlFor="universe-style-rules" className="label text-xs font-bold">
								统一风格规则
							</label>
							<textarea
								id="universe-style-rules"
								name="universe-style-rules"
								className="textarea textarea-bordered bg-base-200 w-full h-16 text-sm"
								placeholder="角色设计、场景风格等统一规则..."
								value={createForm.style_rules}
								onChange={(e) =>
									setCreateForm({ ...createForm, style_rules: e.target.value })
								}
							/>
						</div>

						<div className="flex justify-end gap-2 pt-2">
							<Button variant="ghost" onClick={() => setShowCreate(false)}>
								取消
							</Button>
							<Button
								onClick={handleCreate}
								loading={createMutation.isPending}
								disabled={!createForm.name.trim()}
							>
								创建
							</Button>
						</div>
					</div>
				</Modal>
			)}
		</div>
	);
}
