import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	Tldraw,
	track,
	useEditor,
	type Editor,
	type TLComponents,
} from "tldraw";
import "tldraw/tldraw.css";
import { ImagePreviewModal, VideoPreviewModal } from "~/components/canvas/PreviewModals";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { projectsApi } from "~/services/api";
import { useEditorStore, useShallow } from "~/stores/editorStore";
import type { ComicWorkflowGraph } from "../graph/types";
import { buildComicWorkflow } from "../graph/buildComicWorkflow";
import { layoutComicWorkflow } from "../graph/layoutComicWorkflow";
import { ComicCanvasToolbar } from "./toolbar/ComicCanvasToolbar";
import { workflowShapeUtils } from "./shapes/WorkflowShapeUtils";
import {
	hasStaleWorkflowProjection,
	isProjectedWorkflowShape,
	nodeIdFromShape,
	syncTldrawProjection,
	type WorkflowInteractionMode,
} from "./syncTldrawProjection";

interface ComicWorkflowCanvasProps {
	projectId: number;
	onSelectedNodeIdChange?: (nodeId: string | null) => void;
}

const components: TLComponents = {
	PageMenu: null,
	MainMenu: null,
	Toolbar: null,
	StylePanel: null,
	HelpMenu: null,
	DebugPanel: null,
	DebugMenu: null,
	MenuPanel: null,
	TopPanel: null,
	SharePanel: null,
	ActionsMenu: null,
	QuickActions: null,
	KeyboardShortcutsDialog: null,
	HelperButtons: null,
	ZoomMenu: null,
	ContextMenu: null,
};

export function ComicWorkflowCanvas({
	projectId,
	onSelectedNodeIdChange,
}: ComicWorkflowCanvasProps) {
	const editorRef = useRef<Editor | null>(null);
	const [isInitialized, setIsInitialized] = useState(false);
	const [previewImage, setPreviewImage] = useState<{
		src: string;
		alt: string;
	} | null>(null);
	const [previewVideo, setPreviewVideo] = useState<{
		src: string;
		title: string;
	} | null>(null);

	const {
		characters,
		shots,
		projectVideoUrl,
		projectStatus,
		projectTitle,
		projectSummary,
		projectStory,
		isGenerating,
		awaitingConfirm,
		currentRunId,
		blockingClips,
	} = useEditorStore(
		useShallow((state) => ({
			characters: state.characters,
			shots: state.shots,
			projectVideoUrl: state.projectVideoUrl,
			projectStatus: state.projectStatus,
			projectTitle: state.projectTitle,
			projectSummary: state.projectSummary,
			projectStory: state.projectStory,
			isGenerating: state.isGenerating,
			awaitingConfirm: state.awaitingConfirm,
			currentRunId: state.currentRunId,
			blockingClips: state.blockingClips,
		})),
	);

	const { data: project, isLoading } = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectsApi.get(projectId),
		enabled: projectId > 0,
	});

	const graph = useMemo<ComicWorkflowGraph | null>(() => {
		if (!project) return null;
		return buildComicWorkflow({
			project: {
				...project,
				title: projectTitle ?? project.title,
				story: projectStory ?? project.story,
				summary: projectSummary ?? project.summary,
				video_url: projectVideoUrl ?? project.video_url,
				status: projectStatus ?? project.status,
			},
			characters,
			shots,
			blockingClips,
			isGenerating,
		});
	}, [
		project,
		projectTitle,
		projectStory,
		projectSummary,
		projectVideoUrl,
		projectStatus,
		characters,
		shots,
		blockingClips,
		isGenerating,
	]);

	const layout = useMemo(
		() => (graph ? layoutComicWorkflow(graph) : null),
		[graph],
	);
	const graphSignature = useMemo(
		() => (graph && layout ? JSON.stringify({ graph, layout }) : ""),
		[graph, layout],
	);
	const lastSignatureRef = useRef<string>("");
	const structureLocked = isGenerating || awaitingConfirm || Boolean(currentRunId);
	const interactionMode: WorkflowInteractionMode = structureLocked ? "locked" : "layout";

	useEffect(() => {
		const unsubscribers = [
			canvasEvents.on("preview-image", setPreviewImage),
			canvasEvents.on("preview-video", setPreviewVideo),
			canvasEvents.on("select-workflow-node", ({ nodeId }) => {
				onSelectedNodeIdChange?.(nodeId);
			}),
		];
		return () => {
			unsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	}, [onSelectedNodeIdChange]);

	const syncProjection = useCallback(
		(forceLayout = false) => {
			const editor = editorRef.current;
			if (!editor || !graph || !layout) return;
			syncTldrawProjection({
				editor,
				graph,
				layout,
				interactionMode,
				forceLayout,
			});
			lastSignatureRef.current = `${graphSignature}:${interactionMode}`;
		},
		[graph, graphSignature, interactionMode, layout],
	);

	const handleMount = useCallback(
		(editor: Editor) => {
			editorRef.current = editor;
			if (graph && layout) {
				syncTldrawProjection({ editor, graph, layout, interactionMode });
				lastSignatureRef.current = `${graphSignature}:${interactionMode}`;
				setTimeout(() => {
					editor.zoomToFit({ animation: { duration: 300 } });
				}, 100);
			}
			setIsInitialized(true);
		},
		[graph, graphSignature, interactionMode, layout],
	);

	useEffect(() => {
		if (!isInitialized || !graph || !layout) return;
		const syncKey = `${graphSignature}:${interactionMode}`;
		if (lastSignatureRef.current === syncKey) return;
		syncProjection(false);
	}, [
		graph,
		graphSignature,
		interactionMode,
		isInitialized,
		layout,
		syncProjection,
	]);

	const handleResetLayout = useCallback(() => {
		syncProjection(true);
		const editor = editorRef.current;
		if (editor) {
			setTimeout(() => {
				editor.zoomToFit({ animation: { duration: 260 } });
			}, 80);
		}
	}, [syncProjection]);

	if (isLoading || !graph || !layout) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-base-100 text-sm text-base-content/50">
				正在加载工作流...
			</div>
		);
	}

	return (
		<>
			<div className="infinite-canvas-container relative h-full w-full">
				<Tldraw
					shapeUtils={workflowShapeUtils}
					components={components}
					onMount={handleMount}
					persistenceKey={`openoii-comic-workflow-v1-project-${projectId}`}
				>
					<SelectionBridge
						graph={graph}
						onSelectedNodeIdChange={onSelectedNodeIdChange}
					/>
					<ProjectionSyncBridge
						graph={graph}
						layout={layout}
						interactionMode={interactionMode}
					/>
					<ComicCanvasToolbar
						projectId={projectId}
						onResetLayout={handleResetLayout}
					/>
				</Tldraw>
			</div>

			{previewImage ? (
				<ImagePreviewModal
					src={previewImage.src}
					alt={previewImage.alt}
					onClose={() => setPreviewImage(null)}
				/>
			) : null}

			{previewVideo ? (
				<VideoPreviewModal
					src={previewVideo.src}
					title={previewVideo.title}
					onClose={() => setPreviewVideo(null)}
					showDownload={false}
				/>
			) : null}
		</>
	);
}

const SelectionBridge = track(function SelectionBridge({
	graph,
	onSelectedNodeIdChange,
}: {
	graph: ComicWorkflowGraph;
	onSelectedNodeIdChange?: (nodeId: string | null) => void;
}) {
	const editor = useEditor();
	const selectedIds = editor.getSelectedShapeIds();
	const selectedNodeId = useMemo(() => {
		if (selectedIds.length !== 1) return null;
		const shape = editor.getShape(selectedIds[0]);
		const nodeId = nodeIdFromShape(shape);
		if (!nodeId) return null;
		return graph.nodes.some((node) => node.id === nodeId) ? nodeId : null;
	}, [editor, graph.nodes, selectedIds]);

	useEffect(() => {
		onSelectedNodeIdChange?.(selectedNodeId);
	}, [onSelectedNodeIdChange, selectedNodeId]);

	return null;
});

const ProjectionSyncBridge = track(function ProjectionSyncBridge({
	graph,
	layout,
	interactionMode,
}: {
	graph: ComicWorkflowGraph;
	layout: NonNullable<ReturnType<typeof layoutComicWorkflow>>;
	interactionMode: WorkflowInteractionMode;
}) {
	const editor = useEditor();
	const projectedSignature = editor
		.getCurrentPageShapes()
		.filter(isProjectedWorkflowShape)
		.map((shape) => `${shape.id}:${shape.type}:${shape.x}:${shape.y}`)
		.join("|");

	useEffect(() => {
		const currentShapes = editor.getCurrentPageShapes();
		if (
			!hasStaleWorkflowProjection({
				graph,
				layout,
				interactionMode,
				currentShapes,
			})
		) {
			return;
		}
		syncTldrawProjection({
			editor,
			graph,
			layout,
			interactionMode,
			forceLayout: false,
		});
	}, [editor, graph, interactionMode, layout, projectedSignature]);

	return null;
});
