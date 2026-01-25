import type React from "react";

// Project types
export interface Project {
  id: number;
  title: string;
  story: string | null;
  style: string | null;
  summary: string | null;   // 剧情摘要
  video_url: string | null; // 最终拼接视频
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Character {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  image_url: string | null;
}

export interface Scene {
  id: number;
  project_id: number;
  order: number;
  description: string;
}

export interface Shot {
  id: number;
  scene_id: number;
  order: number;
  description: string;
  prompt: string | null;        // 视频生成 prompt
  image_prompt: string | null;  // 首帧图片生成 prompt
  image_url: string | null;     // 首帧图片
  video_url: string | null;     // 分镜视频
  duration: number | null;
}

export interface AgentRun {
  id: number;
  project_id: number;
  status: string;
  current_agent: string | null;
  progress: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// WebSocket event types
export type WsEventType =
  | "connected"
  | "pong"
  | "echo"
  | "run_started"
  | "run_progress"
  | "run_message"
  | "run_completed"
  | "run_failed"
  | "run_awaiting_confirm"
  | "run_confirmed"
  | "run_cancelled"
  | "agent_handoff"
  | "character_created"
  | "character_updated"
  | "character_deleted"
  | "scene_created"
  | "scene_updated"
  | "scene_deleted"
  | "shot_created"
  | "shot_updated"
  | "shot_deleted"
  | "project_updated"
  | "data_cleared"
  | "error";

export interface WsEvent {
  type: WsEventType;
  data: Record<string, unknown>;
}

export interface AgentMessage {
  id?: string; // 唯一标识符（前端生成）
  agent: string;
  role: string;
  content: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  timestamp?: string;
  progress?: number; // 0-1 之间的进度值
  isLoading?: boolean; // 是否正在加载
}

export interface Message {
  id: number;
  project_id: number;
  run_id: number | null;
  agent: string;
  role: string;
  content: string;
  progress: number | null;
  is_loading: boolean;
  created_at: string;
}

// 工作流阶段类型
export type WorkflowStage = "ideate" | "visualize" | "animate" | "deploy";

// Config types
export type ConfigValue = string | number | boolean | null;

// 后端 API 返回的配置项格式
export interface ConfigItem {
  key: string;
  value: string | null;
  is_sensitive: boolean;
  is_masked: boolean;
  source: "db" | "env";
}

export interface ConfigSection {
  key: string;
  title: string;
  items: ConfigItem[];
}

export type AppConfig = ConfigItem[];
