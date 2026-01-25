// Toast 类型定义
export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration: number; // 自动消失时间（ms），0 表示不自动消失
  actions?: ToastAction[];
  details?: string; // 开发模式下的详细信息
}

// API 错误类
export class ApiError extends Error {
  code: string;
  status?: number;
  details?: Record<string, any>;
  request?: {
    method?: string;
    url?: string;
  };
  response?: any;

  constructor(options: {
    code: string;
    message: string;
    status?: number;
    details?: Record<string, any>;
    request?: { method?: string; url?: string };
    response?: any;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.request = options.request;
    this.response = options.response;
  }
}
