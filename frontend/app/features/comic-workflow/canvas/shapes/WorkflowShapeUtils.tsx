import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	type Geometry2d,
	type RecordProps,
} from "tldraw";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { getStaticUrl } from "~/services/api";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import type { ComicWorkflowNode, WorkflowNodeStatus } from "../../graph/types";
import {
	WORKFLOW_SHAPE_TYPES,
	type WorkflowCardShape,
	type WorkflowFrameShape,
} from "./types";

const SECTION_STYLE = {
	brief: {
		accent: "bg-primary",
		surface: "bg-primary/5",
	},
	elements: {
		accent: "bg-secondary",
		surface: "bg-secondary/5 halftone-bg",
	},
	shotline: {
		accent: "bg-accent",
		surface: "bg-accent/5 halftone-bg",
	},
	output: {
		accent: "bg-base-content",
		surface: "bg-base-200/45",
	},
} as const;

const STATUS_COPY: Record<WorkflowNodeStatus, { label: string; cls: string }> = {
	draft: { label: "待生成", cls: "badge-ghost" },
	generating: { label: "生成中", cls: "badge-warning" },
	review: { label: "待审阅", cls: "badge-warning" },
	approved: { label: "已批准", cls: "badge-success" },
	blocked: { label: "阻塞", cls: "badge-error" },
	superseded: { label: "需重合成", cls: "badge-warning" },
	ready: { label: "可用", cls: "badge-success" },
};

function stopCanvasPointer(e: React.PointerEvent<HTMLElement>) {
	e.stopPropagation();
}

function selectWorkflowNode(nodeId: string) {
	canvasEvents.emit("select-workflow-node", { nodeId });
}

function statusBadge(status: WorkflowNodeStatus) {
	const copy = STATUS_COPY[status] ?? STATUS_COPY.draft;
	return (
		<span className={`badge badge-sm gap-1 ${copy.cls}`}>
			<span className="h-2 w-2 rounded-full bg-current opacity-60" />
			{copy.label}
		</span>
	);
}

function MediaPreviewButton({
	src,
	title,
	type,
}: {
	src: string | null;
	title: string;
	type: "image" | "video";
}) {
	if (!src) return null;

	return (
		<button
			type="button"
			className="btn btn-circle pointer-events-auto h-12 min-h-12 w-12 border-2 border-base-content/20 bg-base-100/90 text-base-content shadow-brutal-sm hover:bg-primary hover:text-primary-content"
			aria-label={type === "image" ? "预览图片" : "预览视频"}
			title={type === "image" ? "预览图片" : "预览视频"}
			onPointerDown={stopCanvasPointer}
			onClick={() => {
				if (type === "image") {
					canvasEvents.emit("preview-image", { src, alt: title });
				} else {
					canvasEvents.emit("preview-video", { src, title });
				}
			}}
		>
			<SvgIcon name={type === "image" ? "image" : "play"} size={17} />
		</button>
	);
}

function EmptyMedia({ label }: { label: string }) {
	return (
		<div className="flex h-full w-full items-center justify-center bg-base-300 text-xs text-base-content/40">
			{label}
		</div>
	);
}

function BriefCard({ node }: { node: Extract<ComicWorkflowNode, { kind: "brief" }> }) {
	const duration = node.metrics.totalDuration
		? `${node.metrics.totalDuration}s`
		: "未定";

	return (
		<div className="flex h-full flex-col p-4">
			<CardHeader node={node} icon="lightbulb" accentClass="bg-primary" />
			<div className="mt-4 grid grid-cols-3 gap-2">
				<Metric label="角色" value={node.metrics.characterCount} />
				<Metric label="镜头" value={node.metrics.shotCount} />
				<Metric label="时长" value={duration} />
			</div>
			<div className="mt-4 min-h-0 flex-1 space-y-3 overflow-hidden">
				{node.project.story ? (
					<p className="m-0 line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-base-content/75">
						{node.project.story}
					</p>
				) : (
					<p className="m-0 text-sm text-base-content/40">等待故事输入</p>
				)}
				{node.project.summary ? (
					<p className="m-0 rounded-lg border border-secondary/20 bg-secondary/10 p-2 text-xs leading-relaxed text-base-content/65">
						{node.project.summary}
					</p>
				) : null}
			</div>
		</div>
	);
}

function CharacterCard({
	node,
}: {
	node: Extract<ComicWorkflowNode, { kind: "character" }>;
}) {
	const imageUrl = getStaticUrl(node.imageUrl);
	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="relative aspect-[4/3] bg-base-300">
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={node.title}
						draggable={false}
						decoding="async"
						loading="lazy"
						className="h-full w-full object-cover"
					/>
				) : (
					<EmptyMedia label="等待角色图" />
				)}
				<div className="absolute right-2 top-2">
					<MediaPreviewButton src={imageUrl} title={node.title} type="image" />
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col p-3">
				<CardHeader node={node} icon="star" accentClass="bg-secondary" compact />
				{node.character.description ? (
					<p className="m-0 mt-3 line-clamp-5 text-xs leading-relaxed text-base-content/60">
						{node.character.description}
					</p>
				) : null}
				<div className="mt-auto flex flex-wrap gap-1 pt-3">
					{node.character.has_embedding ? (
						<span className="badge badge-primary badge-xs">资产一致性</span>
					) : null}
					{node.character.visual_notes ? (
						<span className="badge badge-ghost badge-xs">视觉笔记</span>
					) : null}
				</div>
			</div>
		</div>
	);
}

function ShotCard({ node }: { node: Extract<ComicWorkflowNode, { kind: "shot" }> }) {
	const imageUrl = getStaticUrl(node.imageUrl);
	const videoUrl = getStaticUrl(node.videoUrl);
	const previewType = videoUrl ? "video" : "image";
	const previewUrl = videoUrl || imageUrl;
	const isFirstShot = node.shot.order === 1;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="relative h-[180px] shrink-0 bg-base-300">
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={node.title}
						draggable={false}
						decoding="async"
						loading={isFirstShot ? "eager" : "lazy"}
						{...(isFirstShot
							? ({ fetchpriority: "high" } as { fetchpriority: "high" })
							: {})}
						className="h-full w-full object-cover"
					/>
				) : (
					<EmptyMedia label="等待分镜图" />
				)}
				<span className="absolute left-2 top-2 badge badge-xs bg-base-100/90">
					{node.shot.duration ? `${node.shot.duration}s` : "未定时长"}
				</span>
				<div className="absolute right-2 top-2">
					<MediaPreviewButton
						src={previewUrl}
						title={node.title}
						type={previewType}
					/>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col p-3">
				<CardHeader node={node} icon="clapperboard" accentClass="bg-accent" compact />
				{node.shot.description ? (
					<p className="m-0 mt-3 line-clamp-4 text-xs leading-relaxed text-base-content/65">
						{node.shot.description}
					</p>
				) : null}
				{node.shot.dialogue ? (
					<p className="m-0 mt-2 line-clamp-2 text-xs italic text-primary/80">
						"{node.shot.dialogue}"
					</p>
				) : null}
				<div className="mt-auto flex flex-wrap gap-1 pt-3">
					{node.characterNames.length > 0 ? (
						<span className="badge badge-secondary badge-xs max-w-full truncate">
							{node.characterNames.join("、")}
						</span>
					) : null}
					{node.shot.camera ? (
						<span className="badge badge-ghost badge-xs">{node.shot.camera}</span>
					) : null}
				</div>
			</div>
		</div>
	);
}

function OutputCard({
	node,
}: {
	node: Extract<ComicWorkflowNode, { kind: "output" }>;
}) {
	const videoUrl = getStaticUrl(node.videoUrl);
	const statusText = outputStateLabel(node.outputState);

	return (
		<div className="flex h-full flex-col p-4">
			<CardHeader node={node} icon="play-circle" accentClass="bg-primary" />
			<div className="relative mt-4 aspect-video overflow-hidden rounded-xl bg-base-300">
				{videoUrl ? (
					<>
						<video
							src={videoUrl}
							className="pointer-events-none h-full w-full object-cover opacity-80"
							muted
							preload="metadata"
							playsInline
						/>
						<div className="absolute inset-0 flex items-center justify-center">
							<MediaPreviewButton src={videoUrl} title="最终成片" type="video" />
						</div>
					</>
				) : (
					<EmptyMedia label={statusText} />
				)}
			</div>
			{node.blockingClips.length > 0 ? (
				<div className="mt-3 rounded-lg border border-warning/25 bg-warning/10 p-2 text-xs leading-relaxed text-warning">
					{node.blockingClips
						.map((clip) => `镜头 ${clip.order}: ${clip.reason}`)
						.join("；")}
				</div>
			) : (
				<p className="m-0 mt-3 text-xs text-base-content/50">{statusText}</p>
			)}
		</div>
	);
}

function outputStateLabel(state: Extract<ComicWorkflowNode, { kind: "output" }>["outputState"]) {
	if (state === "ready") return "成片可用";
	if (state === "needs_recompose") return "需要重新合成";
	if (state === "blocked") return "阻塞";
	return "等待合成";
}

function Metric({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="rounded-lg border border-base-content/10 bg-base-200/50 p-2">
			<p className="m-0 text-[10px] font-mono uppercase text-base-content/40">
				{label}
			</p>
			<p className="m-0 truncate font-heading text-lg font-bold">{value}</p>
		</div>
	);
}

function CardHeader({
	node,
	icon,
	accentClass,
	compact = false,
}: {
	node: ComicWorkflowNode;
	icon: "lightbulb" | "star" | "clapperboard" | "play-circle";
	accentClass: string;
	compact?: boolean;
}) {
	return (
		<div className="flex items-start gap-3">
			<div
				className={`flex shrink-0 items-center justify-center rounded-xl text-primary-content shadow-brutal-sm ${accentClass} ${
					compact ? "h-8 w-8" : "h-9 w-9"
				}`}
			>
				<SvgIcon name={icon} size={compact ? 15 : 17} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<h3 className="m-0 truncate font-heading text-sm font-bold">
						{node.title}
					</h3>
					{statusBadge(node.status)}
				</div>
				<p className="m-0 truncate text-[11px] font-mono uppercase text-base-content/45">
					{node.subtitle}
				</p>
			</div>
		</div>
	);
}

export class WorkflowFrameShapeUtil extends ShapeUtil<WorkflowFrameShape> {
	static override type = WORKFLOW_SHAPE_TYPES.FRAME;

	static override props: RecordProps<WorkflowFrameShape> = {
		w: T.number,
		h: T.number,
		section: T.any,
		title: T.string,
		eyebrow: T.string,
		status: T.any,
		countLabel: T.string,
		draggable: T.optional(T.boolean),
	};

	getDefaultProps(): WorkflowFrameShape["props"] {
		return {
			w: 520,
			h: 360,
			section: "brief",
			title: "Brief",
			eyebrow: "01 / STORY",
			status: "draft",
			countLabel: "",
			draggable: true,
		};
	}

	override canEdit() {
		return false;
	}

	override canResize() {
		return false;
	}

	getGeometry(shape: WorkflowFrameShape): Geometry2d {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		});
	}

	component(shape: WorkflowFrameShape) {
		const { w, h, section, title, eyebrow, countLabel, draggable = true } =
			shape.props;
		const style = SECTION_STYLE[section];
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
				<section
					className={`h-full w-full rounded-[1.25rem] border-3 border-base-content/15 p-5 shadow-brutal-sm ${
						draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
					} ${style.surface}`}
					onPointerDown={draggable ? undefined : stopCanvasPointer}
				>
					<div className="flex items-center gap-3">
						<span className={`h-9 w-1.5 rounded-full ${style.accent}`} />
						<div className="min-w-0">
							<p className="m-0 text-[10px] font-mono uppercase text-base-content/45">
								{eyebrow}
							</p>
							<h2 className="m-0 font-heading text-lg font-bold leading-tight">
								{title}
							</h2>
							<p className="m-0 text-[11px] font-mono uppercase text-base-content/45">
								{countLabel}
							</p>
						</div>
					</div>
				</section>
			</HTMLContainer>
		);
	}

	indicator(shape: WorkflowFrameShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={20} />;
	}

	override canReceiveNewChildrenOfType(
		_shape: WorkflowFrameShape,
		type: string,
	) {
		return type === WORKFLOW_SHAPE_TYPES.CARD;
	}
}

export class WorkflowCardShapeUtil extends ShapeUtil<WorkflowCardShape> {
	static override type = WORKFLOW_SHAPE_TYPES.CARD;

	static override props: RecordProps<WorkflowCardShape> = {
		w: T.number,
		h: T.number,
		node: T.any,
		draggable: T.optional(T.boolean),
	};

	getDefaultProps(): WorkflowCardShape["props"] {
		return {
			w: 300,
			h: 320,
			node: {} as ComicWorkflowNode,
			draggable: false,
		};
	}

	override canEdit() {
		return false;
	}

	override canResize() {
		return false;
	}

	getGeometry(shape: WorkflowCardShape): Geometry2d {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		});
	}

	component(shape: WorkflowCardShape) {
		const { w, h, node, draggable = false } = shape.props;
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
				<article
					className="card-comic h-full select-none overflow-hidden border-3 border-base-content/25 bg-base-100"
					onPointerDown={draggable ? undefined : stopCanvasPointer}
					onClick={() => selectWorkflowNode(node.id)}
				>
					{node.kind === "brief" ? <BriefCard node={node} /> : null}
					{node.kind === "character" ? <CharacterCard node={node} /> : null}
					{node.kind === "shot" ? <ShotCard node={node} /> : null}
					{node.kind === "output" ? <OutputCard node={node} /> : null}
				</article>
			</HTMLContainer>
		);
	}

	indicator(shape: WorkflowCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
	}
}

export const workflowShapeUtils = [
	WorkflowFrameShapeUtil,
	WorkflowCardShapeUtil,
];
