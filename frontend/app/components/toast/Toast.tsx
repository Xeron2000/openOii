import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect } from "react";
import { useToastStore } from "~/stores/toast.store";
import type { Toast as ToastType } from "~/types/errors";

interface ToastProps {
  toast: ToastType;
}

export function Toast({ toast }: ToastProps) {
  const removeToast = useToastStore((state) => state.removeToast);

  useEffect(() => {
    if (toast.duration > 0) {
      const timer = setTimeout(() => {
        removeToast(toast.id);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, removeToast]);

  const typeStyles = {
    success: "border-l-[#51CF66]",
    error: "border-l-[#FF6B6B]",
    warning: "border-l-[#FFD93D]",
    info: "border-l-[#74C0FC]",
  };

  return (
    <div
      className={`
        relative min-w-[320px] max-w-[480px] p-4 bg-white
        border-4 border-black border-l-8 ${typeStyles[toast.type]}
        shadow-[8px_8px_0_rgba(0,0,0,0.2)]
        transform -rotate-[0.5deg]
        animate-slide-in-right
      `}
    >
      {/* 标题和关闭按钮 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-heading font-bold text-base">{toast.title}</h4>
        <button
          onClick={() => removeToast(toast.id)}
          className="btn btn-ghost btn-xs btn-circle hover:bg-base-200"
          aria-label="关闭"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* 消息内容 */}
      <p className="text-sm text-base-content/80">{toast.message}</p>

      {/* 操作按钮 */}
      {toast.actions && toast.actions.length > 0 && (
        <div className="flex gap-2 mt-3">
          {toast.actions.map((action, index) => (
            <button
              key={index}
              onClick={() => {
                action.onClick();
                removeToast(toast.id);
              }}
              className={`btn btn-xs border-2 border-black ${
                action.variant === "primary"
                  ? "btn-primary"
                  : "btn-ghost hover:bg-base-200"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
