import type {
	ComicWorkflowGraph,
	ComicWorkflowNode,
	ComicWorkflowSection,
} from "./types";

export interface WorkflowRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface WorkflowLayoutNode extends WorkflowRect {
	id: string;
	node: ComicWorkflowNode;
}

export interface WorkflowLayoutFrame extends WorkflowRect {
	id: string;
	section: ComicWorkflowSection;
}

export interface ComicWorkflowLayout {
	frames: WorkflowLayoutFrame[];
	nodes: WorkflowLayoutNode[];
}

const CARD_SIZE: Record<ComicWorkflowNode["kind"], { w: number; h: number }> = {
	brief: { w: 420, h: 330 },
	character: { w: 260, h: 330 },
	shot: { w: 320, h: 430 },
	output: { w: 440, h: 320 },
};

const GAP = {
	section: 84,
	card: 24,
	framePaddingX: 34,
	frameHeader: 84,
};

const START = { x: 120, y: 120 };

function rows(count: number, columns: number): number {
	return Math.max(1, Math.ceil(count / columns));
}

function nodesForSection(
	graph: ComicWorkflowGraph,
	section: ComicWorkflowSection,
): ComicWorkflowNode[] {
	return graph.nodes.filter((node) => node.section === section);
}

function frameForCards({
	x,
	y,
	cardWidth,
	cardHeight,
	columns,
	count,
	minWidth,
	minHeight,
}: {
	x: number;
	y: number;
	cardWidth: number;
	cardHeight: number;
	columns: number;
	count: number;
	minWidth: number;
	minHeight: number;
}): WorkflowRect {
	const rowCount = rows(count, columns);
	return {
		x,
		y,
		w: Math.max(
			minWidth,
			GAP.framePaddingX * 2 + columns * cardWidth + (columns - 1) * GAP.card,
		),
		h: Math.max(
			minHeight,
			GAP.frameHeader +
				rowCount * cardHeight +
				(rowCount - 1) * GAP.card +
				GAP.framePaddingX,
		),
	};
}

export function layoutComicWorkflow(
	graph: ComicWorkflowGraph,
): ComicWorkflowLayout {
	const briefNodes = nodesForSection(graph, "brief");
	const characterNodes = nodesForSection(graph, "elements");
	const shotNodes = nodesForSection(graph, "shotline");
	const outputNodes = nodesForSection(graph, "output");
	const characterColumns = Math.max(1, Math.min(4, characterNodes.length || 1));
	const shotColumns = Math.max(1, shotNodes.length || 1);

	const briefFrame: WorkflowLayoutFrame = {
		id: "frame:brief",
		section: "brief",
		x: START.x,
		y: START.y,
		w: 500,
		h: 520,
	};

	const elementsFrame = {
		id: "frame:elements",
		section: "elements" as const,
		...frameForCards({
			x: briefFrame.x + briefFrame.w + GAP.section,
			y: START.y,
			cardWidth: CARD_SIZE.character.w,
			cardHeight: CARD_SIZE.character.h,
			columns: characterColumns,
			count: characterNodes.length,
			minWidth: 860,
			minHeight: 440,
		}),
	};

	const shotlineFrame = {
		id: "frame:shotline",
		section: "shotline" as const,
		...frameForCards({
			x: elementsFrame.x,
			y: elementsFrame.y + elementsFrame.h + GAP.section,
			cardWidth: CARD_SIZE.shot.w,
			cardHeight: CARD_SIZE.shot.h,
			columns: shotColumns,
			count: shotNodes.length,
			minWidth: 980,
			minHeight: 560,
		}),
	};

	const outputFrame: WorkflowLayoutFrame = {
		id: "frame:output",
		section: "output",
		x: shotlineFrame.x + shotlineFrame.w + GAP.section,
		y: shotlineFrame.y + 40,
		w: 540,
		h: 430,
	};

	const layoutNodes: WorkflowLayoutNode[] = [];

	for (const node of briefNodes) {
		layoutNodes.push({
			id: node.id,
			node,
			x: briefFrame.x + 40,
			y: briefFrame.y + GAP.frameHeader,
			...CARD_SIZE.brief,
		});
	}

	characterNodes.forEach((node, index) => {
		const row = Math.floor(index / characterColumns);
		const column = index % characterColumns;
		layoutNodes.push({
			id: node.id,
			node,
			x:
				elementsFrame.x +
				GAP.framePaddingX +
				column * (CARD_SIZE.character.w + GAP.card),
			y:
				elementsFrame.y +
				GAP.frameHeader +
				row * (CARD_SIZE.character.h + GAP.card),
			...CARD_SIZE.character,
		});
	});

	shotNodes.forEach((node, index) => {
		layoutNodes.push({
			id: node.id,
			node,
			x: shotlineFrame.x + GAP.framePaddingX + index * (CARD_SIZE.shot.w + GAP.card),
			y: shotlineFrame.y + GAP.frameHeader,
			...CARD_SIZE.shot,
		});
	});

	for (const node of outputNodes) {
		layoutNodes.push({
			id: node.id,
			node,
			x: outputFrame.x + 50,
			y: outputFrame.y + GAP.frameHeader,
			...CARD_SIZE.output,
		});
	}

	return {
		frames: [briefFrame, elementsFrame, shotlineFrame, outputFrame],
		nodes: layoutNodes,
	};
}
