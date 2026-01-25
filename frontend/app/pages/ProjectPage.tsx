import {
  Bars3Icon,
  FaceFrownIcon,
  PencilIcon,
  StopIcon,
} from "@heroicons/react/24/outline";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChatPanel } from "~/components/chat/ChatPanel";
import { Sidebar } from "~/components/layout/Sidebar";
import { StageView } from "~/components/layout/StageView";
import { SettingsModal } from "~/components/settings/SettingsModal";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { useProjectWebSocket } from "~/hooks/useWebSocket";
import { projectsApi } from "~/services/api";
import { useEditorStore } from "~/stores/editorStore";
import { useSidebarStore } from "~/stores/sidebarStore";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = parseInt(id || "0");
  const queryClient = useQueryClient();
  const store = useEditorStore();
  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebarStore();
  const autoStartTriggered = useRef(false);
  const retryCount = useRef(0);

  const { send } = useProjectWebSocket(projectId);

  const { data: project, isLoading: projectLoading, error: projectError } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: projectId > 0,
    retry: 1,
  });

  // 显示项目加载错误
  useEffect(() => {
    if (projectError) {
      const apiError = projectError instanceof ApiError ? projectError : null;
      toast.error({
        title: "加载项目失败",
        message: apiError?.message || "无法获取项目信息",
        actions: [
          {
            label: "重试",
            onClick: () => queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
          },
        ],
      });
    }
  }, [projectError, projectId, queryClient]);

  const { data: characters } = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => projectsApi.getCharacters(projectId),
    enabled: !!project,
  });

  const { data: scenes } = useQuery({
    queryKey: ["scenes", projectId],
    queryFn: () => projectsApi.getScenes(projectId),
    enabled: !!project,
  });

  const { data: shots } = useQuery({
    queryKey: ["shots", projectId],
    queryFn: () => projectsApi.getShots(projectId),
    enabled: !!project,
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", projectId],
    queryFn: () => projectsApi.getMessages(projectId),
    enabled: !!project,
  });

  // 当项目数据加载完成后，更新到 store（依赖 projectId 确保切换时重新加载）
  useEffect(() => {
    if (characters) store.setCharacters(characters);
  }, [characters, projectId]);

  useEffect(() => {
    if (scenes) store.setScenes(scenes);
  }, [scenes, projectId]);

  useEffect(() => {
    if (shots) store.setShots(shots);
  }, [shots, projectId]);

  // 初始化 projectVideoUrl
  useEffect(() => {
    if (project?.video_url) {
      store.setProjectVideoUrl(project.video_url);
    }
  }, [project?.video_url]);

  // 加载历史消息（只在数据加载完成后执行一次）
  const messagesLoadedRef = useRef(false);

  // 当项目 ID 变化时，立即清空状态，确保项目完全独立
  useEffect(() => {
    // 重置消息加载标记
    messagesLoadedRef.current = false;

    // 清空消息
    store.clearMessages();

    // 清空生成状态
    store.setGenerating(false);
    store.setProgress(0);
    store.setCurrentAgent(null);
    store.setCurrentStage("ideate");

    // 清空确认状态
    store.setAwaitingConfirm(false, null, null);
    store.setCurrentRunId(null);

    // 清空选中状态
    store.setSelectedScene(null);
    store.setSelectedShot(null);
    store.setSelectedCharacter(null);
    store.setHighlightedMessage(null);

    // 清空项目视频
    store.setProjectVideoUrl(null);

    // 注意：不清空画布数据（characters/scenes/shots），让 React Query 的数据自然覆盖
    // 避免竞态条件导致数据被清空
  }, [projectId]);

  // 当新项目的消息加载完成后，恢复历史消息
  useEffect(() => {
    if (messages && !messagesLoadedRef.current) {
      messagesLoadedRef.current = true;
      // 加载历史消息（使用数据库 ID 作为消息 ID）
      messages.forEach((msg) => {
        store.addMessage({
          id: `db_${msg.id}`,
          agent: msg.agent,
          role: msg.role,
          content: msg.content,
          timestamp: msg.created_at,
          progress: msg.progress ?? undefined,
          isLoading: msg.is_loading,
        });
      });
    }
  }, [messages]);

  const generateMutation = useMutation({
    mutationFn: () => projectsApi.generate(projectId),
    onSuccess: () => {
      // 重置重试计数
      retryCount.current = 0;
    },
    onError: async (error: Error | ApiError) => {
      const apiError = error instanceof ApiError ? error : null;
      const isConflict = apiError?.status === 409 || error.message.includes("409");

      // 如果是 409 冲突，自动取消并重试（最多重试 1 次）
      if (isConflict && retryCount.current < 1) {
        retryCount.current += 1;
        try {
          await projectsApi.cancel(projectId);
          // 取消成功后重新生成
          generateMutation.mutate();
        } catch {
          // 取消失败，提示用户
          retryCount.current = 0;
          toast.warning({
            title: "任务冲突",
            message: "有一个任务正在运行中，请稍后再试",
          });
        }
      } else if (isConflict) {
        // 重试次数用尽，提示用户
        retryCount.current = 0;
        toast.warning({
          title: "任务冲突",
          message: "有一个任务正在运行中，请稍后再试",
        });
      } else {
        // 其他错误
        toast.error({
          title: "生成失败",
          message: apiError?.message || error.message || "未知错误",
          details: import.meta.env.DEV ? JSON.stringify(apiError?.details) : undefined,
        });
      }
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: (content: string) => projectsApi.feedback(projectId, content),
    onSuccess: () => {
      // feedback API 成功会创建新的 run，WebSocket 会收到 run_started 事件
    },
    onError: (error: Error | ApiError) => {
      const apiError = error instanceof ApiError ? error : null;
      const isConflict = apiError?.status === 409 || error.message.includes("409");

      if (isConflict) {
        toast.info({
          title: "正在处理中",
          message: "请稍候...",
        });
      } else {
        toast.error({
          title: "反馈失败",
          message: apiError?.message || error.message || "未知错误",
        });
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => projectsApi.cancel(projectId),
    onSettled: () => {
      store.setGenerating(false);
      store.setProgress(0);
      store.setCurrentAgent(null);
      store.setAwaitingConfirm(false, null, null);
      store.setCurrentRunId(null);
      store.addMessage({
        agent: "system",
        role: "system",
        content: "生成已停止",
        icon: StopIcon,
        timestamp: new Date().toISOString(),
      });
    },
  });

  const handleGenerate = async () => {
    store.clearMessages();
    store.setCurrentStage("ideate");
    generateMutation.mutate();
  };

  const handleFeedback = (content: string) => {
    feedbackMutation.mutate(content);
    store.addMessage({
      agent: "user",
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    });
  };

  const handleConfirm = (feedback?: string) => {
    const runId = store.currentRunId;
    if (runId) {
      // 有活跃的 run，通过 WebSocket 发送
      send({ type: "confirm", data: { run_id: runId, feedback } });
      if (feedback) {
        store.addMessage({
          agent: "user",
          role: "user",
          content: feedback,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      // 没有活跃的 run 时，记录警告而不是错误地调用 feedback API
      console.warn("[handleConfirm] No active run ID, cannot send confirm");
    }
  };

  const handleCancel = () => {
    cancelMutation.mutate();
  };

  useEffect(() => {
    if (!store.isGenerating && store.progress === 1) {
      queryClient.invalidateQueries({ queryKey: ["characters", projectId] });
      queryClient.invalidateQueries({ queryKey: ["scenes", projectId] });
      queryClient.invalidateQueries({ queryKey: ["shots", projectId] });
    }
  }, [store.isGenerating, store.progress, projectId, queryClient]);

  // 监听项目更新事件，刷新项目数据
  const projectUpdatedAt = useEditorStore((state) => state.projectUpdatedAt);
  useEffect(() => {
    if (projectUpdatedAt) {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] }); // 同时刷新列表
    }
  }, [projectUpdatedAt, projectId, queryClient]);

  useEffect(() => {
    const autoStart = searchParams.get("autoStart");
    if (
      autoStart === "true" &&
      project &&
      !autoStartTriggered.current &&
      !store.isGenerating
    ) {
      autoStartTriggered.current = true;
      setSearchParams({}, { replace: true });
      store.clearMessages();
      store.setCurrentStage("ideate");
      generateMutation.mutate();
    }
  }, [project, searchParams, setSearchParams, store, generateMutation]);

  if (projectLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-base-100">
        <PencilIcon className="w-6 h-6 animate-bounce" aria-hidden="true" />
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
          <FaceFrownIcon
            className="w-6 h-6 mx-auto mb-4 animate-wiggle"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-heading font-bold mb-4">项目未找到</h1>
          <Link to="/">
            <Button variant="primary">返回首页</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <SettingsModal />
      <div
        className={`h-screen flex flex-col bg-base-100 font-sans transition-all duration-300 ease-in-out ${
          sidebarOpen ? "ml-72" : "ml-0"
        }`}
      >
        <header className="flex-shrink-0 bg-base-100/80 backdrop-blur-sm border-b-3 border-black px-4 z-10">
          <div className="flex items-center h-14">
            <div className="w-10">
              {!sidebarOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="!px-2"
                  onClick={toggleSidebar}
                  title="展开侧边栏"
                >
                  <Bars3Icon className="w-5 h-5" />
                </Button>
              )}
            </div>
            <h1
              className="flex-1 text-lg font-heading font-semibold truncate text-center"
              title={project.title}
            >
              {project.title}
            </h1>
            <div className="w-10" />
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-4 gap-4">
          <div className="w-1/3 min-w-[320px] max-w-[480px] h-full flex flex-col">
            <ChatPanel
              onSendFeedback={handleFeedback}
              onConfirm={handleConfirm}
              onGenerate={handleGenerate}
              onCancel={handleCancel}
              isGenerating={store.isGenerating || generateMutation.isPending}
            />
          </div>

          <div className="flex-1 overflow-hidden">
            <StageView projectId={projectId} />
          </div>
        </main>
      </div>
    </>
  );
}
