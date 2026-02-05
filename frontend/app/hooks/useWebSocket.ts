import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "~/stores/editorStore";
import type { WsEvent, WorkflowStage } from "~/types";
import { toast } from "~/utils/toast";

const WS_BASE = import.meta.env.VITE_WS_URL || "ws://localhost:18765";
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

// 生成唯一消息 ID
let messageIdCounter = 0;
function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

// 全局连接管理，防止 StrictMode 导致的重复连接
const globalConnections = new Map<number, WebSocket>();

export function useProjectWebSocket(projectId: number | null) {
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!projectId) return;

    clearReconnectTimer();

    // 复用已有连接，必要时创建新连接
    const existingWs = globalConnections.get(projectId);
    let ws = existingWs;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      ws = new WebSocket(`${WS_BASE}/ws/projects/${projectId}`);
      globalConnections.set(projectId, ws);
    }

    ws.onopen = () => {
      console.log("[WS] 已连接到项目", projectId);
      reconnectAttempts.current = 0;
      // 如果之前显示了断开提示，现在清除
      toast.success({
        title: "连接成功",
        message: "实时更新已恢复",
        duration: 2000,
      });
    };

    ws.onmessage = (event) => {
      try {
        const data: WsEvent = JSON.parse(event.data);
        handleWsEvent(data, useEditorStore.getState());
      } catch (e) {
        console.error("[WS] 解析错误:", e);
        toast.error({
          title: "消息解析失败",
          message: "收到无效的服务器消息",
          duration: 3000,
        });
      }
    };

    ws.onerror = (error) => {
      console.error("[WS] 连接错误:", error);
      toast.error({
        title: "连接错误",
        message: "WebSocket 连接出现问题",
        duration: 0, // 不自动消失
        actions: [
          {
            label: "重新连接",
            onClick: () => {
              reconnectAttempts.current = 0;
              connect();
            },
          },
        ],
      });
    };

    ws.onclose = () => {
      console.log("[WS] 连接断开");
      globalConnections.delete(projectId);

      // 自动重连，避免切换页面后连接中断
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current++;
        console.log(`[WS] ${RECONNECT_DELAY / 1000}秒后尝试重连 (${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})`);

        toast.warning({
          title: "连接已断开",
          message: `正在尝试重新连接... (${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})`,
          duration: RECONNECT_DELAY,
        });

        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
      } else {
        toast.error({
          title: "连接失败",
          message: "无法连接到服务器，请检查网络或刷新页面",
          duration: 0, // 不自动消失
          actions: [
            {
              label: "刷新页面",
              onClick: () => window.location.reload(),
            },
          ],
        });
      }
    };
  }, [projectId, clearReconnectTimer]);

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttempts.current = MAX_RECONNECT_ATTEMPTS; // 阻止自动重连
    if (projectId) {
      const ws = globalConnections.get(projectId);
      if (ws) {
        ws.close();
        globalConnections.delete(projectId);
      }
    }
  }, [projectId, clearReconnectTimer]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (!projectId) return;
    const ws = globalConnections.get(projectId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, [projectId]);

  useEffect(() => {
    reconnectAttempts.current = 0;
    connect();

    // Cleanup: 组件卸载时断开连接
    return () => {
      clearReconnectTimer();
      // 注意：不在这里调用 disconnect()，因为可能是 StrictMode 的双重挂载
      // 只清理定时器，让连接在下次 connect() 时复用或在 onclose 时自动清理
    };
  }, [projectId, connect, clearReconnectTimer]);

  return { send, disconnect, reconnect: connect };
}

function handleWsEvent(event: WsEvent, store: ReturnType<typeof useEditorStore.getState>) {
  switch (event.type) {
    case "connected":
      console.log("[WS] 服务器确认连接");
      break;
    case "run_started":
      store.setGenerating(true);
      store.setProgress(0);
      // 不清空消息，而是添加分隔线
      store.addMessage({
        id: generateMessageId(),
        agent: "system",
        role: "separator",
        content: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        timestamp: new Date().toISOString(),
      });
      store.setCurrentRunId(event.data.run_id as number);
      store.setAwaitingConfirm(false);
      if (event.data.stage) {
        store.setCurrentStage(event.data.stage as WorkflowStage);
      }
      break;
    case "run_progress":
      store.setCurrentAgent(event.data.current_agent as string);
      store.setProgress(event.data.progress as number);
      if (event.data.stage) {
        store.setCurrentStage(event.data.stage as WorkflowStage);
      }
      break;
    case "run_message":
      // 当收到同一个 agent 的新消息时，结束之前该 agent 的 loading 状态
      {
        const newAgent = event.data.agent as string;
        const currentMessages = store.messages;

        // 找到该 agent 最后一条 isLoading=true 的消息并结束它
        const updatedMessages = currentMessages.map((msg) => {
          // 只处理同一个 agent 的消息，且是 isLoading 状态
          if (msg.agent === newAgent && msg.isLoading) {
            return { ...msg, isLoading: false };
          }
          return msg;
        });

        // 如果有消息被更新，先更新 store
        if (updatedMessages.some((msg, idx) => msg !== currentMessages[idx])) {
          store.setMessages(updatedMessages);
        }

        // 更新全局进度（如果消息带有 progress 字段）
        const msgProgress = event.data.progress as number | undefined;
        if (typeof msgProgress === "number" && msgProgress >= 0 && msgProgress <= 1) {
          store.setProgress(msgProgress);
        }

        // 然后添加新消息
        store.addMessage({
          id: generateMessageId(),
          agent: newAgent,
          role: event.data.role as string,
          content: event.data.content as string,
          timestamp: new Date().toISOString(),
          progress: event.data.progress as number | undefined,
          isLoading: event.data.isLoading as boolean | undefined,
        });
      }
      break;
    case "agent_handoff":
      // Agent 邀请消息 - 同时清除所有 isLoading 状态
      {
        const currentMessages = store.messages;
        const updatedMessages = currentMessages.map((msg) => {
          if (msg.isLoading) {
            return { ...msg, isLoading: false };
          }
          return msg;
        });
        if (updatedMessages.some((msg, idx) => msg !== currentMessages[idx])) {
          store.setMessages(updatedMessages);
        }
      }
      store.addMessage({
        id: generateMessageId(),
        agent: "system",
        role: "handoff",
        content: event.data.message as string,
        timestamp: new Date().toISOString(),
      });
      break;
    case "run_awaiting_confirm":
      // 清除所有 isLoading 状态
      {
        const currentMessages = store.messages;
        const updatedMessages = currentMessages.map((msg) => {
          if (msg.isLoading) {
            return { ...msg, isLoading: false };
          }
          return msg;
        });
        if (updatedMessages.some((msg, idx) => msg !== currentMessages[idx])) {
          store.setMessages(updatedMessages);
        }
      }
      store.setAwaitingConfirm(true, event.data.agent as string, event.data.run_id as number);
      store.addMessage({
        id: generateMessageId(),
        agent: "system",
        role: "info",
        content: event.data.message as string,
        timestamp: new Date().toISOString(),
      });
      break;
    case "run_confirmed":
      // 只清除 awaitingConfirm 状态，保留 currentRunId（run 仍在进行中）
      store.setAwaitingConfirm(false);
      store.addMessage({
        id: generateMessageId(),
        agent: "system",
        role: "info",
        content: `已确认，继续执行...`,
        timestamp: new Date().toISOString(),
      });
      break;
    case "run_completed":
      // 清除所有 isLoading 状态
      {
        const currentMessages = store.messages;
        const updatedMessages = currentMessages.map((msg) => {
          if (msg.isLoading) {
            return { ...msg, isLoading: false };
          }
          return msg;
        });
        if (updatedMessages.some((msg, idx) => msg !== currentMessages[idx])) {
          store.setMessages(updatedMessages);
        }
      }
      store.setGenerating(false);
      store.setProgress(1);
      store.setCurrentAgent(null);
      store.setAwaitingConfirm(false);
      store.setCurrentRunId(null);
      store.setCurrentStage("deploy");
      break;
    case "run_failed":
      // 清除所有 isLoading 状态
      {
        const currentMessages = store.messages;
        const updatedMessages = currentMessages.map((msg) => {
          if (msg.isLoading) {
            return { ...msg, isLoading: false };
          }
          return msg;
        });
        if (updatedMessages.some((msg, idx) => msg !== currentMessages[idx])) {
          store.setMessages(updatedMessages);
        }
      }
      store.setGenerating(false);
      store.setAwaitingConfirm(false);
      store.setCurrentRunId(null);
      store.addMessage({
        id: generateMessageId(),
        agent: "system",
        role: "error",
        content: `生成失败: ${event.data.error}`,
        timestamp: new Date().toISOString(),
      });
      // 显示 Toast 通知
      toast.error({
        title: "生成失败",
        message: (event.data.error as string) || "未知错误",
        duration: 5000,
      });
      break;
    case "error":
      // 处理 WebSocket 错误事件
      console.error("[WS] 服务器错误:", event.data);
      toast.error({
        title: "服务器错误",
        message: (event.data.message as string) || "发生未知错误",
        details: import.meta.env.DEV ? (event.data.code as string) : undefined,
      });
      break;
    case "character_created":
    case "character_updated":
      // 实时更新角色数据
      if (event.data.character) {
        const character = event.data.character as any;
        const currentCharacters = store.characters;
        const existingIndex = currentCharacters.findIndex((c) => c.id === character.id);
        if (existingIndex >= 0) {
          // 更新现有角色
          const newCharacters = [...currentCharacters];
          newCharacters[existingIndex] = character;
          store.setCharacters(newCharacters);
        } else {
          // 添加新角色
          store.setCharacters([...currentCharacters, character]);
        }
      }
      break;
    case "shot_created":
    case "shot_updated":
      // 实时更新分镜数据
      if (event.data.shot) {
        const shot = event.data.shot as any;
        const currentShots = store.shots;
        const existingIndex = currentShots.findIndex((s) => s.id === shot.id);
        if (existingIndex >= 0) {
          // 更新现有分镜
          const newShots = [...currentShots];
          newShots[existingIndex] = shot;
          store.setShots(newShots);
        } else {
          // 添加新分镜
          store.setShots([...currentShots, shot]);
        }
      }
      break;
    case "character_deleted":
      // 删除角色
      {
        const charId = event.data.character_id as number | undefined;
        if (charId !== undefined) {
          store.setCharacters(store.characters.filter((c) => c.id !== charId));
        }
      }
      break;
    case "shot_deleted":
      // 删除分镜
      {
        const shotId = event.data.shot_id as number | undefined;
        if (shotId !== undefined) {
          store.setShots(store.shots.filter((s) => s.id !== shotId));
        }
      }
      break;
    case "data_cleared":
      // 数据清理事件（重新生成时触发）
      {
        const clearedTypes = event.data.cleared_types as string[] | undefined;
        if (clearedTypes) {
          if (clearedTypes.includes("characters")) {
            store.setCharacters([]);
          }
          if (clearedTypes.includes("shots")) {
            store.setShots([]);
          }
        }
      }
      break;
    case "project_updated":
      // 项目更新事件（标题、视频等更新时触发）
      {
        const projectData = event.data.project as { video_url?: string; title?: string } | undefined;
        if (projectData?.video_url) {
          store.setProjectVideoUrl(projectData.video_url);
        }
        // 触发项目数据刷新
        store.setProjectUpdatedAt(Date.now());
      }
      break;
  }
}
