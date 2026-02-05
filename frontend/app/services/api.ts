import { ApiError } from "~/types/errors";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:18765";

/**
 * 将后端静态文件路径转换为完整 URL
 * @param path 后端返回的路径，如 "/static/videos/xxx.mp4"
 * @returns 完整 URL，如 "http://localhost:18765/static/videos/xxx.mp4"
 */
export function getStaticUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  // 如果已经是完整 URL，直接返回
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  // 拼接 API_BASE
  return `${API_BASE}${path}`;
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    // 处理 204 No Content 响应
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return undefined as T;
    }

    // 尝试解析响应体
    let data: T;
    try {
      data = await res.json();
    } catch {
      // JSON 解析失败，如果响应不成功则抛出错误
      if (!res.ok) {
        throw new ApiError({
          code: "INVALID_RESPONSE",
          message: "服务器返回了无效的响应格式",
          status: res.status,
          request: {
            method: options?.method || "GET",
            url: endpoint,
          },
        });
      }
      // 响应成功但无法解析 JSON，返回 undefined（用于 204 等情况）
      return undefined as T;
    }

    if (!res.ok) {
      // 解析后端返回的结构化错误
      const errorObj = data as unknown as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
      const errorData = errorObj.error || {};
      throw new ApiError({
        code: errorData.code || "API_ERROR",
        message: errorData.message || res.statusText || "请求失败",
        status: res.status,
        details: errorData.details as Record<string, unknown> | undefined,
        request: {
          method: options?.method || "GET",
          url: endpoint,
        },
        response: data as Record<string, unknown>,
      });
    }

    return data;
  } catch (error) {
    // 如果已经是 ApiError，直接抛出
    if (error instanceof ApiError) {
      throw error;
    }

    // 网络错误或其他错误
    throw new ApiError({
      code: "NETWORK_ERROR",
      message: "网络连接失败，请检查您的网络设置",
      details: { originalError: String(error) },
      request: {
        method: options?.method || "GET",
        url: endpoint,
      },
    });
  }
}

// Projects API
export const projectsApi = {
  list: async () => {
    const data = await fetchApi<{ items: import("~/types").Project[]; total: number }>("/api/v1/projects");
    return data.items;
  },
  
  get: (id: number) => fetchApi<import("~/types").Project>(`/api/v1/projects/${id}`),
  
  create: (data: { title: string; story?: string; style?: string }) =>
    fetchApi<import("~/types").Project>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  
  update: (id: number, data: Partial<import("~/types").Project>) =>
    fetchApi<import("~/types").Project>(`/api/v1/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  
  delete: (id: number) =>
    fetchApi<void>(`/api/v1/projects/${id}`, { method: "DELETE" }),
  
  getCharacters: (id: number) =>
    fetchApi<import("~/types").Character[]>(`/api/v1/projects/${id}/characters`),

  getShots: (id: number) =>
    fetchApi<import("~/types").Shot[]>(`/api/v1/projects/${id}/shots`),

  getMessages: (id: number) =>
    fetchApi<import("~/types").Message[]>(`/api/v1/projects/${id}/messages`),

  generate: (id: number, data?: { seed?: number; notes?: string }) =>
    fetchApi<import("~/types").AgentRun>(`/api/v1/projects/${id}/generate`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),

  cancel: (id: number) =>
    fetchApi<{ status: string; cancelled: number }>(`/api/v1/projects/${id}/cancel`, {
      method: "POST",
    }),

  feedback: (id: number, content: string, runId?: number) =>
    fetchApi<{ status: string }>(`/api/v1/projects/${id}/feedback`, {
      method: "POST",
      body: JSON.stringify({ content, run_id: runId }),
    }),
};

// Shots API
export const shotsApi = {
  update: (id: number, data: Partial<import("~/types").Shot>) =>
    fetchApi<import("~/types").Shot>(`/api/v1/shots/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  regenerate: (id: number, type: "image" | "video") =>
    fetchApi<import("~/types").AgentRun>(`/api/v1/shots/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
  delete: (id: number) =>
    fetchApi<void>(`/api/v1/shots/${id}`, { method: "DELETE" }),
};

// Characters API
export const charactersApi = {
  update: (id: number, data: Partial<import("~/types").Character>) =>
    fetchApi<import("~/types").Character>(`/api/v1/characters/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  regenerate: (id: number) =>
    fetchApi<import("~/types").AgentRun>(`/api/v1/characters/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ type: "image" }),
    }),
  delete: (id: number) =>
    fetchApi<void>(`/api/v1/characters/${id}`, { method: "DELETE" }),
};

// Config API
export const configApi = {
  get: () => fetchApi<import("~/types").ConfigItem[]>("/api/v1/config"),
  update: (config: Record<string, import("~/types").ConfigValue>) =>
    fetchApi<{ updated: number; skipped: number; restart_required: boolean; restart_keys: string[]; message: string }>("/api/v1/config", {
      method: "PUT",
      body: JSON.stringify({ configs: config }),
    }),
  testConnection: (service: "llm" | "image" | "video", configOverrides?: Record<string, string | null>) =>
    fetchApi<{ success: boolean; message: string; details: string | null }>("/api/v1/config/test-connection", {
      method: "POST",
      body: JSON.stringify({ service, config_overrides: configOverrides }),
    }),
  revealValue: (key: string) =>
    fetchApi<{ key: string; value: string | null }>("/api/v1/config/reveal", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
};
