import type { ShotUpdatePayload } from "~/types";

export type ShapeActionName = "add-to-assets" | "approve" | "edit" | "history" | "regenerate";

export interface ShapeActionPayload {
  shapeId: string;
  action: ShapeActionName;
  entityType: "character" | "shot";
  entityId: number;
  feedbackType: "render";
  shotPatch?: ShotUpdatePayload;
  feedbackContent?: string;
}

// 事件类型定义 — 只保留仍在使用的事件
export interface CanvasEvents {
  "preview-image": { src: string; alt: string };
  "preview-video": { src: string; title: string };
  "select-workflow-node": { nodeId: string };
  "shape-action": ShapeActionPayload;
  "version-history": { entityType: "character" | "shot"; entityId: number };
}

type EventCallback<T> = (data: T) => void;
type AnyEventCallback = (data: CanvasEvents[keyof CanvasEvents]) => void;

// 事件总线单例
class CanvasEventBus {
  private listeners: Partial<Record<keyof CanvasEvents, Set<AnyEventCallback>>> = {};

  on<K extends keyof CanvasEvents>(
    event: K,
    callback: EventCallback<CanvasEvents[K]>
  ): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event].add(callback as EventCallback<CanvasEvents[keyof CanvasEvents]>);

    // 返回取消订阅函数
    return () => {
      this.listeners[event]?.delete(callback as EventCallback<CanvasEvents[keyof CanvasEvents]>);
    };
  }

  emit<K extends keyof CanvasEvents>(event: K, data: CanvasEvents[K]): void {
    const callbacks = this.listeners[event];
    if (callbacks) {
      callbacks.forEach((callback) => {
        callback(data);
      });
    }
  }

  off<K extends keyof CanvasEvents>(
    event: K,
    callback?: EventCallback<CanvasEvents[K]>
  ): void {
    if (callback) {
      this.listeners[event]?.delete(callback as EventCallback<CanvasEvents[keyof CanvasEvents]>);
    } else {
      delete this.listeners[event];
    }
  }

  clear(): void {
    this.listeners = {};
  }
}

export const canvasEvents = new CanvasEventBus();
