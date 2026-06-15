import { useState, useRef, useEffect } from "react";
import { useEditorStore, useShallow } from "~/stores/editorStore";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { OutlinePreviewCard } from "./OutlinePreviewCard";
import { Button } from "~/components/ui/Button";
import type { WorkflowStage } from "~/types";
import { AGENT_NAME_MAP } from "~/types";
import {
  CheckIcon,
  LightBulbIcon,
  PaintBrushIcon,
  RocketLaunchIcon,
  StopIcon,
  BoltIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/outline";
import { getWorkflowStageInfo } from "~/utils/workflowStage";

interface ChatPanelProps {
  onSendFeedback: (content: string) => void;
  onConfirm: (feedback?: string) => void;
  onCancel: () => void;
  isGenerating: boolean;
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
}

function getStageIcon(stage: WorkflowStage) {
  if (stage === "compose") return RocketLaunchIcon;
  if (stage === "render" || stage === "render_approval") return PaintBrushIcon;
  if (stage === "plan" || stage === "plan_approval") return LightBulbIcon;
  return LightBulbIcon;
}

const agentNameMap = AGENT_NAME_MAP;

export function ChatPanel({
  onSendFeedback,
  onConfirm,
  onCancel,
  isGenerating,
  isPaused = false,
  onPause,
  onResume: _onResume,
}: ChatPanelProps) {
  const {
    messages,
    currentAgent,
    awaitingConfirm,
    awaitingAgent,
    currentStage,
    currentRunId,
    runMode,
    recoveryGate,
  } = useEditorStore(useShallow((s) => ({
    messages: s.messages,
    currentAgent: s.currentAgent,
    awaitingConfirm: s.awaitingConfirm,
    awaitingAgent: s.awaitingAgent,
    currentStage: s.currentStage,
    currentRunId: s.currentRunId,
    runMode: s.runMode,
    recoveryGate: s.recoveryGate,
  })));

  const setRunMode = useEditorStore((s) => s.setRunMode);
  const [input, setInput] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      if (typeof scrollContainerRef.current.scrollTo === "function") {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      } else {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    if (currentRunId || isGenerating || awaitingConfirm) {
      onConfirm(input.trim());
      setInput("");
      return;
    }
    onSendFeedback(input);
    setInput("");
  };

  const fallbackStage = currentStage || "plan";
  const info = getWorkflowStageInfo(fallbackStage) ?? {
    title: "规划阶段",
    description: "正在生成剧本、角色与镜头规划",
  };
  const StageIcon = getStageIcon(fallbackStage);
  const hasMessages = messages.length > 0;
  const agentDisplayName = awaitingAgent ? agentNameMap[awaitingAgent] || awaitingAgent : "";
  const isYolo = runMode === "yolo";

  const showManualConfirm = awaitingConfirm && !isYolo;
  const showOutlinePreview =
    showManualConfirm && awaitingAgent === "outline" && recoveryGate?.story_outline;
  const handleRunModeToggle = () => {
    const nextMode = isYolo ? "manual" : "yolo";
    setRunMode(nextMode);
    if (nextMode === "yolo" && awaitingConfirm) {
      onConfirm(undefined);
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full bg-base-100">
      <div className="px-2.5 py-1.5 border-b border-base-content/10 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StageIcon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          <span className="text-xs font-heading font-bold">{info.title}</span>
        </div>

        <button
          type="button"
          onClick={handleRunModeToggle}
          className={`btn min-h-11 h-11 gap-1 px-3 text-xs font-heading font-bold ${isYolo ? "btn-primary border-2" : "btn-ghost"}`}
          aria-label={isYolo ? "切换精细审阅模式" : "切换快速生成模式"}
          title={isYolo ? "快速生成：自动确认" : "精细审阅：逐阶段确认"}
        >
          {isYolo ? (
            <>
              <BoltIcon className="h-4 w-4" />
              快速
            </>
          ) : (
            <>
              <AdjustmentsHorizontalIcon className="h-4 w-4" />
              审阅
            </>
          )}
        </button>
      </div>

      {isGenerating && !awaitingConfirm && (
        <div className="px-2.5 py-1 border-b border-base-content/10 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-base-content/50">
            <span className="loading loading-dots loading-xs text-primary" />
            {agentNameMap[currentAgent || ""] || currentAgent || "处理中"}...
            {isYolo && (
              <span className="badge badge-primary badge-outline badge-xs gap-0.5 border-2">
                <BoltIcon className="w-2 h-2" /> 快速
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="min-h-11 gap-1 px-3 text-error hover:bg-error/10"
            aria-label="停止生成"
          >
            <StopIcon className="h-4 w-4" /> 停止
          </Button>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2.5 py-2 halftone-bg">
        {!hasMessages && !isGenerating ? (
          <div className="flex flex-col h-full">
            <div className="flex-1 flex flex-col items-center justify-center text-center px-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center mb-2">
                <StageIcon className="w-4 h-4 text-primary" aria-hidden="true" />
              </div>
              <p className="text-xs text-base-content/50 mb-3 max-w-xs">
                当前阶段暂无对话
              </p>
            </div>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      {showOutlinePreview && recoveryGate?.story_outline && (
        <div className="px-2.5 py-2 border-t-2 border-primary/30 bg-primary/5">
          <OutlinePreviewCard
            outline={recoveryGate.story_outline}
            visualBible={recoveryGate.visual_bible}
            onConfirm={() => {
              onConfirm(undefined);
              setInput("");
            }}
            onRegenerate={(feedback) => {
              onConfirm(feedback);
              setInput("");
            }}
          />
        </div>
      )}

      {showManualConfirm && !showOutlinePreview && (
        <div className="px-2.5 py-1.5 border-t-2 border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-base-content/60 font-medium">
              {agentDisplayName} 已完成 — 确认继续？
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const feedback = input.trim();
                onConfirm(feedback || undefined);
                setInput("");
              }}
              className="min-h-11 gap-1 border-2 px-3 shadow-brutal-sm"
            >
              <CheckIcon className="h-4 w-4" />
              通过
            </Button>
          </div>
        </div>
      )}

      {awaitingConfirm && isYolo && isPaused && onPause && (
        <div className="px-2.5 py-1 border-t border-base-content/10 bg-primary/5 flex items-center gap-1.5 text-xs text-base-content/50">
          <BoltIcon className="h-4 w-4" />
          快速生成已暂停
          <Button size="sm" variant="ghost" onClick={onPause} className="ml-auto min-h-11 px-3">
            继续
          </Button>
        </div>
      )}

      <div className="p-2 border-t border-base-content/10">
        <MessageInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={false}
          placeholder={
            awaitingConfirm
              ? "修改意见（可选）..."
              : isGenerating
                ? "反馈..."
                : "你的想法..."
          }
        />
      </div>
    </div>
  );
}
