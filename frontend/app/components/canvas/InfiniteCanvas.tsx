import { ComicWorkflowCanvas } from "~/features/comic-workflow/canvas/ComicWorkflowCanvas";

interface InfiniteCanvasProps {
	projectId: number;
	onSelectedNodeIdChange?: (nodeId: string | null) => void;
}

export function InfiniteCanvas({
	projectId,
	onSelectedNodeIdChange,
}: InfiniteCanvasProps) {
	return (
		<ComicWorkflowCanvas
			projectId={projectId}
			onSelectedNodeIdChange={onSelectedNodeIdChange}
		/>
	);
}
