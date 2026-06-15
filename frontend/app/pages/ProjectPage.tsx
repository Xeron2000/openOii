import { ArrowPathIcon, StopIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Link,
	useParams,
	useSearchParams,
} from "react-router-dom";
import { TopBar } from "~/components/layout/TopBar";
import { StagePipeline } from "~/components/layout/StagePipeline";
import { StageView } from "~/components/layout/StageView";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { useProjectWebSocket } from "~/hooks/useWebSocket";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { buildComicWorkflow } from "~/features/comic-workflow/graph/buildComicWorkflow";
import {
	WorkspaceSidebar,
	type WorkspaceSidebarTab,
} from "~/features/comic-workflow/sidebar/WorkspaceSidebar";
import {
	deriveWorkbenchStatus,
	type LastRunTerminalStatus,
} from "~/features/comic-workflow/state/deriveWorkbenchStatus";
import { projectsApi } from "~/services/api";
import { useEditorStore, useShallow } from "~/stores/editorStore";
import type {
	ProjectProviderSettings,
	RecoveryControlRead,
	VersionEntityType,
	WorkflowStage,
} from "~/types";
import { ApiError } from "~/types/errors";
import { toast } from "~/utils/toast";
import { isWorkflowStage } from "~/utils/workflowStage";

const VersionCompareDrawer = lazy(() =>
	import("~/components/panels/VersionCompareDrawer").then((m) => ({
		default: m.VersionCompareDrawer,
	})),
);

type FeedbackType = "plan" | "render" | "compose";

function feedbackTypeForStage(stage: WorkflowStage): FeedbackType {
	if (stage === "render" || stage === "render_approval") return "render";
	if (stage === "compose") return "compose";
	return "plan";
}

export function ProjectPage() {
	const { id } = useParams<{ id: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
	const projectId = parseInt(id || "0", 10);
	const queryClient = useQueryClient();
	const {
		isGenerating: storeIsGenerating,
		currentRunId: storeCurrentRunId,
		currentStage: storeCurrentStage,
		progress: storeProgress,
		awaitingConfirm: storeAwaitingConfirm,
		recoveryControl: storeRecoveryControl,
		runMode: storeRunMode,
		characters: storeCharacters,
		shots: storeShots,
		blockingClips: storeBlockingClips,
		projectTitle: storeProjectTitle,
		projectStory: storeProjectStory,
		projectSummary: storeProjectSummary,
		projectVideoUrl: storeProjectVideoUrl,
		projectStatus: storeProjectStatus,
	} = useEditorStore(
		useShallow((s) => ({
			isGenerating: s.isGenerating,
			currentRunId: s.currentRunId,
			currentStage: s.currentStage,
			progress: s.progress,
			awaitingConfirm: s.awaitingConfirm,
			recoveryControl: s.recoveryControl,
			runMode: s.runMode,
			characters: s.characters,
			shots: s.shots,
			blockingClips: s.blockingClips,
			projectTitle: s.projectTitle,
			projectStory: s.projectStory,
			projectSummary: s.projectSummary,
			projectVideoUrl: s.projectVideoUrl,
			projectStatus: s.projectStatus,
		})),
	);
	const hasActiveRun = storeIsGenerating || Boolean(storeCurrentRunId);
	const hasRecovery = Boolean(storeRecoveryControl);
	const [sidebarTab, setSidebarTab] = useState<WorkspaceSidebarTab>("chat");
	const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [lastRunStatus, setLastRunStatus] =
		useState<LastRunTerminalStatus>(null);
	const [versionOpen, setVersionOpen] = useState(false);
	const [versionTarget, setVersionTarget] = useState<{
		entityType: VersionEntityType;
		entityId: number;
	} | null>(null);
	const autoStartTriggered = useRef(false);
	const generateRequestTokenRef = useRef(0);
	const retryCount = useRef(0);
	const messagesLoadedRef = useRef(false);
	const runModeInitializedRef = useRef<number | null>(null);

	const { send } = useProjectWebSocket(projectId);

	useEffect(() => {
		return canvasEvents.on("version-history", (target) => {
			setVersionTarget({ entityType: target.entityType, entityId: target.entityId });
			setVersionOpen(true);
		});
	}, []);

	const syncStoreWithActiveRun = (run: {
		id: number;
		current_agent?: string | null;
		progress?: number | null;
		provider_snapshot?: ProjectProviderSettings | null;
	}) => {
		const s = useEditorStore.getState();
		s.setGenerating(true);
		s.setCurrentRunId(run.id);
		s.setCurrentAgent(run.current_agent ?? "orchestrator");
		s.setProgress(typeof run.progress === "number" ? run.progress : 0);
		s.setCurrentRunProviderSnapshot(run.provider_snapshot ?? null);
		s.setAwaitingConfirm(false, null, run.id);
		s.setRecoveryControl(null);
		s.setRecoverySummary(null);
		s.setRecoveryGate(null);
		setLastRunStatus(null);
	};

	const {
		data: project,
		isLoading: projectLoading,
		error: projectError,
	} = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectsApi.get(projectId),
		enabled: projectId > 0,
		retry: 1,
	});

	useEffect(() => {
		if (projectError) {
			const apiError = projectError instanceof ApiError ? projectError : null;
			toast.error({
				title: "无法加载项目",
				message: apiError?.message || "项目数据获取失败，请重试",
				actions: [
					{
						label: "重试",
						onClick: () =>
							queryClient.invalidateQueries({
								queryKey: ["project", projectId],
							}),
					},
				],
			});
		}
	}, [projectError, projectId, queryClient]);

	const { data: characters, isLoading: charactersLoading } = useQuery({
		queryKey: ["characters", projectId],
		queryFn: () => projectsApi.getCharacters(projectId),
		enabled: !!project,
	});

	const { data: shots, isLoading: shotsLoading } = useQuery({
		queryKey: ["shots", projectId],
		queryFn: () => projectsApi.getShots(projectId),
		enabled: !!project,
	});

	const { data: messages, isLoading: messagesLoading } = useQuery({
		queryKey: ["messages", projectId],
		queryFn: () => projectsApi.getMessages(projectId),
		enabled: !!project,
	});

	useEffect(() => {
		if (characters) {
			useEditorStore.getState().setCharacters(characters);
		}
	}, [characters]);

	useEffect(() => {
		if (shots) {
			useEditorStore.getState().setShots(shots);
		}
	}, [shots]);

	useEffect(() => {
		if (project) {
			const editorStore = useEditorStore.getState();
			editorStore.setProjectVideoUrl(project.video_url ?? null);
			editorStore.setProjectStatus(project.status ?? null);
			editorStore.setProjectTitle(project.title ?? null);
			editorStore.setProjectSummary(project.summary ?? null);
			editorStore.setProjectStory(project.story ?? null);
			editorStore.setProjectStyle(project.style ?? null);
			editorStore.setProjectTargetShotCount(project.target_shot_count ?? null);
			editorStore.setProjectCharacterHints(project.character_hints ?? null);
			editorStore.setProjectCreationMode(project.creation_mode ?? null);
			editorStore.setProjectReferenceImages(project.reference_images ?? null);
			editorStore.setProjectExports(project.exports ?? null);
			editorStore.setProjectProviderSettings(project.provider_settings ?? null);
			editorStore.setProjectUniverseId(project.universe_id ?? null);
			editorStore.setProjectChapterNumber(project.chapter_number ?? null);
			editorStore.setProjectChapterTitle(project.chapter_title ?? null);
			editorStore.setProjectStoryOutline(project.story_outline ?? null);
			editorStore.setProjectVisualBible(project.visual_bible ?? null);
			editorStore.setProjectOutlineApproved(project.outline_approved ?? false);
			if (runModeInitializedRef.current !== project.id) {
				editorStore.setRunMode(
					project.creation_mode === "quick" ? "yolo" : "manual",
				);
				runModeInitializedRef.current = project.id;
			}
		}
	}, [project]);

	useLayoutEffect(() => {
		if (projectId <= 0) return;

		generateRequestTokenRef.current += 1;
		messagesLoadedRef.current = false;
		runModeInitializedRef.current = null;
		const editorStore = useEditorStore.getState();

		editorStore.clearMessages();
		editorStore.resetRunState();
		editorStore.setCurrentStage("plan");
		editorStore.setSelectedShot(null);
		editorStore.setSelectedCharacter(null);
		editorStore.setHighlightedMessage(null);
		editorStore.setCharacters([]);
		editorStore.setShots([]);
		editorStore.setProjectVideoUrl(null);
		editorStore.setProjectStatus(null);
		editorStore.setProjectTitle(null);
		editorStore.setProjectSummary(null);
		editorStore.setProjectStory(null);
		editorStore.setProjectStyle(null);
		editorStore.setProjectTargetShotCount(null);
		editorStore.setProjectCharacterHints(null);
		editorStore.setProjectCreationMode(null);
		editorStore.setProjectReferenceImages(null);
		editorStore.setProjectExports(null);
		editorStore.setProjectProviderSettings(null);
		editorStore.setProjectUniverseId(null);
		editorStore.setProjectChapterNumber(null);
		editorStore.setProjectChapterTitle(null);
		editorStore.setProjectStoryOutline(null);
		editorStore.setProjectVisualBible(null);
		editorStore.setProjectOutlineApproved(false);
		editorStore.setBlockingClips(null);
		setLastRunStatus(null);
		setSelectedNodeId(null);
		setSidebarTab("chat");
	}, [projectId]);

	useEffect(() => {
		if (messages && !messagesLoadedRef.current) {
			messagesLoadedRef.current = true;
			const editorStore = useEditorStore.getState();
			messages.forEach((msg) => {
				editorStore.addMessage({
					id: `db_${msg.id}`,
					agent: msg.agent,
					role: msg.role,
					content: msg.content,
					timestamp: msg.created_at,
					progress: msg.progress ?? undefined,
					// 从数据库加载的消息不再显示为加载中
					isLoading: false,
				});
			});
		}
	}, [messages]);

	const generateMutation = useMutation({
		mutationFn: ({ requestToken }: { requestToken: number }) =>
			projectsApi
				.generate(projectId, {
					auto_mode: useEditorStore.getState().runMode === "yolo",
				})
				.then((run) => ({ run, requestToken })),
		onSuccess: ({ run, requestToken }) => {
			if (requestToken !== generateRequestTokenRef.current) return;
			syncStoreWithActiveRun(run);
			retryCount.current = 0;
		},
		onError: async (error: Error | ApiError, variables) => {
			if (variables?.requestToken !== generateRequestTokenRef.current) return;
			const apiError = error instanceof ApiError ? error : null;
			const isConflict =
				apiError?.status === 409 || error.message.includes("409");

			if (isConflict) {
				retryCount.current = 0;
				const control = apiError?.response as RecoveryControlRead | undefined;
				if (control) {
					useEditorStore.getState().setRecoveryControl(control);
					useEditorStore
						.getState()
						.setRecoverySummary(control.recovery_summary);
					useEditorStore.getState().setCurrentRunId(control.active_run.id);
					useEditorStore.getState().setGenerating(control.state === "active");
					if (control.state === "active") {
						useEditorStore
							.getState()
							.setCurrentAgent(control.active_run.current_agent);
						useEditorStore.getState().setProgress(control.active_run.progress);
					}
				} else {
					toast.warning({
						title: "请稍等片刻",
						message: "另一个任务正在进行，完成后再试",
					});
				}
			} else {
				toast.error({
					title: "生成失败",
					message:
						apiError?.message ||
						error.message ||
						"生成过程出错，请重试或联系支持",
					details: import.meta.env.DEV
						? JSON.stringify(apiError?.details)
						: undefined,
				});
			}
		},
	});

	const feedbackMutation = useMutation({
		mutationFn: (content: string) =>
			projectsApi.feedback(
				projectId,
				content,
				undefined,
				feedbackTypeForStage(storeCurrentStage),
			),
		onError: (error: Error | ApiError) => {
			const apiError = error instanceof ApiError ? error : null;
			const isConflict =
				apiError?.status === 409 || error.message.includes("409");

			if (isConflict) {
				toast.info({
					title: "AI 正在思考",
					message: "请等待当前任务完成",
				});
			} else {
				toast.error({
					title: "提交失败",
					message: apiError?.message || error.message || "无法发送反馈，请重试",
				});
			}
		},
	});

	const cancelMutation = useMutation({
		mutationFn: () => projectsApi.cancel(projectId),
		onSuccess: (result) => {
			if (result?.status === "cancelled") {
				setLastRunStatus("cancelled");
			}
		},
		onSettled: () => {
			useEditorStore.getState().resetRunState();
			useEditorStore.getState().addMessage({
				agent: "system",
				role: "system",
				content: "生成已停止",
				icon: StopIcon,
				timestamp: new Date().toISOString(),
			});
		},
	});

	const resumeMutation = useMutation({
		mutationFn: () => {
			const control = storeRecoveryControl;
			if (!control) {
				throw new Error("没有可恢复的运行");
			}
			return projectsApi.resume(projectId, control.active_run.id);
		},
		onSuccess: (run) => {
			const control = storeRecoveryControl;
			const s = useEditorStore.getState();
			s.setGenerating(true);
			s.setCurrentRunId(run.id);
			s.setCurrentAgent(run.current_agent);
			s.setProgress(run.progress);
			s.setCurrentRunProviderSnapshot(run.provider_snapshot ?? null);
			if (control) {
				const nextStage =
					control.recovery_summary.next_stage ??
					control.recovery_summary.current_stage;
				if (isWorkflowStage(nextStage)) {
					s.setCurrentStage(nextStage);
				}
			}
			s.setRecoveryControl(null);
			s.setRecoverySummary(null);
			s.setRecoveryGate(null);
			setLastRunStatus(null);
		},
		onError: (error: Error | ApiError) => {
			const apiError = error instanceof ApiError ? error : null;
			toast.error({
				title: "恢复失败",
				message:
					apiError?.message || error.message || "无法恢复当前运行，请重试",
			});
		},
	});

	const handleGenerate = async () => {
		if (generateMutation.isPending || hasActiveRun) return;
		const requestToken = generateRequestTokenRef.current + 1;
		generateRequestTokenRef.current = requestToken;
		setLastRunStatus(null);
		useEditorStore.getState().clearMessages();
		useEditorStore.getState().setCurrentStage("plan");
		generateMutation.mutate({ requestToken });
	};

	const handleFeedback = (content: string) => {
		setLastRunStatus(null);
		feedbackMutation.mutate(content);
		useEditorStore.getState().addMessage({
			agent: "user",
			role: "user",
			content,
			timestamp: new Date().toISOString(),
		});
	};

	const handleConfirm = (feedback?: string) => {
		const runId = storeCurrentRunId;
		if (runId) {
			send({ type: "confirm", data: { run_id: runId, feedback } });
			if (feedback) {
				useEditorStore.getState().addMessage({
					agent: "user",
					role: "user",
					content: feedback,
					timestamp: new Date().toISOString(),
				});
			}
		}
	};

	const handleCancel = () => {
		const activeRunId =
			storeCurrentRunId ?? storeRecoveryControl?.active_run.id ?? null;
		if (
			!activeRunId &&
			!storeIsGenerating &&
			storeRecoveryControl?.state !== "active"
		) {
			return;
		}
		generateRequestTokenRef.current += 1;
		cancelMutation.mutate();
	};

	const handleResume = () => {
		if (!storeRecoveryControl) return;
		resumeMutation.mutate();
	};

	useEffect(() => {
		if (!storeIsGenerating) {
			const progress = useEditorStore.getState().progress;
			if (progress === 1) {
				queryClient.invalidateQueries({ queryKey: ["characters", projectId] });
				queryClient.invalidateQueries({ queryKey: ["shots", projectId] });
			}
		}
	}, [storeIsGenerating, projectId, queryClient]);

	const projectUpdatedAt = useEditorStore((state) => state.projectUpdatedAt);
	useEffect(() => {
		if (projectUpdatedAt) {
			queryClient.invalidateQueries({ queryKey: ["project", projectId] });
			queryClient.invalidateQueries({ queryKey: ["projects"] });
		}
	}, [projectUpdatedAt, projectId, queryClient]);

	useEffect(() => {
		if (storeAwaitingConfirm && storeRunMode === "manual") {
			setSidebarTab("chat");
			setWorkspaceCollapsed(false);
		}
	}, [storeAwaitingConfirm, storeRunMode]);

	useEffect(() => {
		const autoStart = searchParams.get("autoStart");
		if (
			autoStart === "true" &&
			project &&
			!autoStartTriggered.current &&
			!hasActiveRun
		) {
			const editorStore = useEditorStore.getState();
			autoStartTriggered.current = true;
			setSearchParams({}, { replace: true });
			const requestToken = generateRequestTokenRef.current + 1;
			generateRequestTokenRef.current = requestToken;
			setLastRunStatus(null);
			editorStore.clearMessages();
			editorStore.setCurrentStage("plan");
			generateMutation.mutate({ requestToken });
		}
	}, [project, searchParams, setSearchParams, generateMutation]);

	const selectedWorkflowNode = useMemo(() => {
		if (!project || !selectedNodeId) return null;
		const graph = buildComicWorkflow({
			project: {
				...project,
				title: storeProjectTitle ?? project.title,
				story: storeProjectStory ?? project.story,
				summary: storeProjectSummary ?? project.summary,
				video_url: storeProjectVideoUrl ?? project.video_url,
				status: storeProjectStatus ?? project.status,
			},
			characters: storeCharacters,
			shots: storeShots,
			blockingClips: storeBlockingClips,
			isGenerating: storeIsGenerating,
		});
		return graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
	}, [
		project,
		selectedNodeId,
		storeCharacters,
		storeShots,
		storeBlockingClips,
		storeIsGenerating,
		storeProjectTitle,
		storeProjectStory,
		storeProjectSummary,
		storeProjectVideoUrl,
		storeProjectStatus,
	]);

	const handleSelectedNodeIdChange = useCallback((nodeId: string | null) => {
		setSelectedNodeId(nodeId);
		if (nodeId) {
			setSidebarTab("inspector");
			setWorkspaceCollapsed(false);
		}
	}, []);

	const workspaceLoading =
		projectLoading ||
		Boolean(project && (charactersLoading || shotsLoading || messagesLoading));

	const workbenchStatus = useMemo(
		() =>
			deriveWorkbenchStatus({
				isGenerating: storeIsGenerating,
				currentRunId: storeCurrentRunId,
				awaitingConfirm: storeAwaitingConfirm,
				recoveryControl: storeRecoveryControl,
				projectStatus: storeProjectStatus ?? project?.status,
				projectVideoUrl: storeProjectVideoUrl ?? project?.video_url,
				blockingClips: storeBlockingClips,
				lastRunStatus,
			}),
		[
			storeIsGenerating,
			storeCurrentRunId,
			storeAwaitingConfirm,
			storeRecoveryControl,
			storeProjectStatus,
			project?.status,
			storeProjectVideoUrl,
			project?.video_url,
			storeBlockingClips,
			lastRunStatus,
		],
	);

	if (workspaceLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-base-100">
				<ArrowPathIcon className="w-6 h-6 animate-pulse text-base-content/60" />
				<p className="font-sketch text-2xl text-base-content/80">
					正在加载项目...
				</p>
			</div>
		);
	}

	if (!project) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-base-100">
				<Card className="text-center">
					<h1 className="text-2xl font-heading font-bold mb-4">项目未找到</h1>
					<Link to="/">
						<Button variant="primary">返回首页</Button>
					</Link>
				</Card>
			</div>
		);
	}

	return (
		<div className="h-screen flex flex-col bg-base-100 font-sans overflow-hidden">
			<TopBar projectId={projectId} />
			<StagePipeline
				currentStage={storeCurrentStage}
				isGenerating={hasActiveRun}
				progress={storeProgress}
				workbenchStatus={workbenchStatus}
				awaitingConfirm={storeAwaitingConfirm}
				hasRecovery={hasRecovery}
				onGenerate={handleGenerate}
				onResume={handleResume}
				onCancel={handleCancel}
				onToggleChat={() => {
					setSidebarTab("chat");
					setWorkspaceCollapsed(false);
				}}
				generateDisabled={generateMutation.isPending || hasActiveRun}
			/>

			<main
				className="relative flex flex-1 overflow-hidden"
				aria-label="漫剧工作台"
			>
				<div className="flex-1 relative overflow-hidden">
					<StageView
						projectId={projectId}
						onSelectedNodeIdChange={handleSelectedNodeIdChange}
					/>
				</div>

				<WorkspaceSidebar
					activeTab={sidebarTab}
					onTabChange={setSidebarTab}
					projectId={projectId}
					selectedNode={selectedWorkflowNode}
					structureLocked={hasActiveRun || storeAwaitingConfirm}
					onSendFeedback={handleFeedback}
					onConfirm={handleConfirm}
					onCancel={handleCancel}
					isGenerating={hasActiveRun}
					collapsed={workspaceCollapsed}
					onCollapsedChange={setWorkspaceCollapsed}
				/>
			</main>

			{versionOpen && (
				<Suspense fallback={null}>
					<VersionCompareDrawer
						open
						projectId={project.id}
						initialEntityType={versionTarget?.entityType}
						initialEntityId={versionTarget?.entityId ?? null}
						onClose={() => setVersionOpen(false)}
					/>
				</Suspense>
			)}
		</div>
	);
}
