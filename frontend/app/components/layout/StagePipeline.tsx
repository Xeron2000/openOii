import {
	CheckIcon,
	ExclamationTriangleIcon,
	FilmIcon,
	LightBulbIcon,
	SparklesIcon,
	CubeIcon,
	ArrowPathIcon,
	StopIcon,
	UserIcon,
	PaintBrushIcon,
	ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import type { WorkflowStage } from "~/types";
import { STAGE_PIPELINE, getPipelineStageIndex } from "~/utils/pipeline";
import { Button } from "~/components/ui/Button";
import type { WorkbenchStatus } from "~/features/comic-workflow/state/deriveWorkbenchStatus";

const STAGE_ICONS: Record<string, typeof LightBulbIcon> = {
	bulb: LightBulbIcon,
	sparkle: SparklesIcon,
	film: FilmIcon,
	cube: CubeIcon,
	user: UserIcon,
	palette: PaintBrushIcon,
};

interface StagePipelineProps {
	currentStage: WorkflowStage;
	isGenerating: boolean;
	progress?: number;
	workbenchStatus: WorkbenchStatus;
	awaitingConfirm: boolean;
	hasRecovery: boolean;
	onGenerate?: () => void;
	onResume: () => void;
	onCancel: () => void;
	onToggleChat?: () => void;
	generateDisabled?: boolean;
}

const WORKBENCH_STATUS_CLASSES: Record<WorkbenchStatus["state"], string> = {
	idle: "border-base-content/15 bg-base-200 text-base-content/80",
	generating: "border-warning/35 bg-warning/15 text-base-content",
	awaitingConfirm: "border-info/40 bg-info/15 text-base-content",
	recoverable: "border-warning/40 bg-warning/15 text-base-content",
	cancelled: "border-base-content/15 bg-base-200 text-base-content/75",
	ready: "border-success/40 bg-success/15 text-base-content",
	superseded: "border-warning/40 bg-warning/15 text-base-content",
	blocked: "border-error/40 bg-error/15 text-base-content",
};

export function StagePipeline({
	currentStage,
	isGenerating,
	progress = 0,
	workbenchStatus,
	awaitingConfirm,
	hasRecovery,
	onGenerate,
	onResume,
	onCancel,
	onToggleChat,
	generateDisabled,
}: StagePipelineProps) {
	const currentIndex = getPipelineStageIndex(currentStage);
	const progressPercent = Math.max(0, Math.min(100, Math.round(progress * 100)));
	const generateLabel =
		workbenchStatus.state === "idle" ? "开始生成" : "重新生成项目";

	return (
		<div className="z-20 flex min-h-[4rem] flex-shrink-0 flex-col gap-2 border-b border-base-content/10 bg-base-200/65 px-3 py-1.5 lg:min-h-12 lg:flex-row lg:items-center lg:gap-4">
			<span className="sr-only" aria-live="polite">
				工作台状态：{workbenchStatus.label}
			</span>
			<div className="flex min-w-0 items-center gap-3">
				<span
					className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 font-mono text-xs font-semibold tracking-wide ${WORKBENCH_STATUS_CLASSES[workbenchStatus.state]}`}
					title={workbenchStatus.description}
				>
					{workbenchStatus.label}
				</span>
				<div className="flex min-w-[7.5rem] flex-1 items-center gap-2 sm:max-w-[14rem] lg:flex-none">
					<div
						className="h-2 flex-1 overflow-hidden rounded-full bg-base-content/10"
						role="progressbar"
						aria-label="生成进度"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={progressPercent}
					>
						<div
							className="h-full rounded-full bg-primary transition-[width] duration-200"
							style={{ width: `${progressPercent}%` }}
						/>
					</div>
					<span className="w-10 text-right font-mono text-xs text-base-content/80">
						{progressPercent}%
					</span>
				</div>
			</div>

			<div className="flex min-w-0 flex-1 items-center gap-3">
				<nav
					className="flex min-w-0 flex-1 items-center overflow-x-auto pb-1 lg:justify-center lg:overflow-visible lg:pb-0"
					aria-label="Pipeline stages"
				>
					{STAGE_PIPELINE.map((stage, index) => {
						const isCurrent = stage.key === currentStage;
						const isPast = index < currentIndex;
						const isGeneratingHere = isCurrent && isGenerating;
						const isAwaiting = isCurrent && awaitingConfirm;
						const isRecoveryPoint = isCurrent && hasRecovery;
						const IconComponent = STAGE_ICONS[stage.icon];

						let dotClass = "bg-base-content/20 border-base-content/20";
						if (isPast) dotClass = "bg-success border-success/50";
						if (isCurrent) dotClass = "bg-primary border-primary/50";
						if (isGeneratingHere) dotClass = "bg-warning border-warning/50 animate-pulse";
						if (isAwaiting) dotClass = "bg-info border-info/50";

						return (
							<div key={stage.key} className="flex shrink-0 items-center">
								<div
									className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 transition-colors duration-150 ${
										isCurrent ? "bg-primary/10 border-2 border-primary/25" : "border-2 border-transparent"
									}`}
									aria-current={isCurrent ? "step" : undefined}
								>
									<div className={`w-3 h-3 rounded-full border-2 ${dotClass}`} />
									<IconComponent className={`w-3.5 h-3.5 ${isPast ? "text-base-content/75" : isCurrent ? "text-base-content" : "text-base-content/70"}`} />
									<span className={`text-xs font-heading font-bold uppercase tracking-wide ${isPast ? "text-base-content/80" : isCurrent ? "text-base-content" : "text-base-content/75"}`}>
										{stage.label}
									</span>
									{isPast && <CheckIcon className="w-2.5 h-2.5 text-success" />}
									{isRecoveryPoint && !isGenerating && (
										<ExclamationTriangleIcon className="w-2.5 h-2.5 text-warning" />
									)}
								</div>
								{index < STAGE_PIPELINE.length - 1 && (
									<div className={`w-5 h-[3px] mx-1 rounded-full ${index < currentIndex ? "bg-success/70" : "bg-base-content/12"}`} />
								)}
							</div>
						);
					})}
				</nav>

				<div className="flex shrink-0 items-center gap-2">
					{hasRecovery && !isGenerating ? (
						<>
							<Button
								variant="primary"
								size="sm"
								className="gap-1 border-2 shadow-brutal-sm"
								onClick={onResume}
							>
								<ArrowPathIcon className="h-4 w-4" />
								恢复
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="gap-1"
								onClick={onCancel}
								aria-label="停止当前任务"
							>
								<StopIcon className="h-4 w-4" />
							</Button>
						</>
					) : null}
					{isGenerating ? (
						<Button
							variant="ghost"
							size="sm"
							className="gap-1 text-error"
							onClick={onCancel}
						>
							<StopIcon className="h-4 w-4" />
							停止
						</Button>
					) : null}
					{awaitingConfirm && onToggleChat ? (
						<Button
							variant="primary"
							size="sm"
							className="gap-1"
							onClick={onToggleChat}
							aria-label="打开对话面板"
						>
							<ChatBubbleLeftRightIcon className="h-4 w-4" />
							去确认
						</Button>
					) : null}
					{!isGenerating && !hasRecovery && !awaitingConfirm && onGenerate ? (
						<Button
							variant="primary"
							size="sm"
							className="gap-1"
							onClick={onGenerate}
							disabled={generateDisabled}
						>
							<SparklesIcon className="h-4 w-4" />
							{generateLabel}
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
