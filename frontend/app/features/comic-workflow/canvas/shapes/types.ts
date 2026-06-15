import type { TLBaseShape } from "tldraw";
import type {
	ComicWorkflowNode,
	ComicWorkflowSection,
	WorkflowNodeStatus,
} from "../../graph/types";

export const WORKFLOW_SHAPE_TYPES = {
	FRAME: "workflow-frame",
	CARD: "workflow-card",
} as const;

export type WorkflowFrameShape = TLBaseShape<
	typeof WORKFLOW_SHAPE_TYPES.FRAME,
	{
		w: number;
		h: number;
		section: ComicWorkflowSection;
		title: string;
		eyebrow: string;
		status: WorkflowNodeStatus;
		countLabel: string;
		draggable?: boolean;
	}
>;

export type WorkflowCardShape = TLBaseShape<
	typeof WORKFLOW_SHAPE_TYPES.CARD,
	{
		w: number;
		h: number;
		node: ComicWorkflowNode;
		draggable?: boolean;
	}
>;

declare module "tldraw" {
	interface TLGlobalShapePropsMap {
		[WORKFLOW_SHAPE_TYPES.FRAME]: WorkflowFrameShape["props"];
		[WORKFLOW_SHAPE_TYPES.CARD]: WorkflowCardShape["props"];
	}
}
