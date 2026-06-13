import { useCallback, useState, useRef, useEffect } from "react";
import { track, useEditor } from "tldraw";
import {
  HandRaisedIcon,
  CursorArrowRaysIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  ArrowsPointingOutIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { exportApi, getStaticUrl } from "~/services/api";
import { toast } from "~/utils/toast";
import type { ExportResponse } from "~/types";
import { ConsistencyPanel } from "~/components/panels/ConsistencyPanel";

interface CanvasToolbarProps {
  className?: string;
  projectId?: number;
}

export const CanvasToolbar = track(function CanvasToolbar({
  className,
  projectId,
}: CanvasToolbarProps) {
  const editor = useEditor();

  // 获取当前工具和缩放级别
  const currentTool = editor.getCurrentToolId();
  const zoom = editor.getZoomLevel();
  const zoomPercent = Math.round(zoom * 100);

  // 导出状态
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "webtoon" | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // 一致性评估面板
  const [showConsistency, setShowConsistency] = useState(false);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportMenuOpen]);

  // 工具切换
  const handleSelectTool = useCallback(() => {
    editor.setCurrentTool("select");
  }, [editor]);

  const handleHandTool = useCallback(() => {
    editor.setCurrentTool("hand");
  }, [editor]);

  // 缩放操作
  const handleZoomIn = useCallback(() => {
    editor.zoomIn(editor.getViewportScreenCenter(), { animation: { duration: 200 } });
  }, [editor]);

  const handleZoomOut = useCallback(() => {
    editor.zoomOut(editor.getViewportScreenCenter(), { animation: { duration: 200 } });
  }, [editor]);

  const handleZoomToFit = useCallback(() => {
    editor.zoomToFit({ animation: { duration: 300 } });
  }, [editor]);

  const handleZoomReset = useCallback(() => {
    editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 200 } });
  }, [editor]);

  // 导出操作
  const handleExport = useCallback(
    async (format: "pdf" | "webtoon") => {
      if (!projectId) return;
      setExportMenuOpen(false);
      setExporting(format);

      const formatLabel = format === "pdf" ? "PDF 漫画册" : "Webtoon 长图";

      try {
        toast.info({
          title: "导出中",
          message: `正在生成${formatLabel}，请稍候...`,
          duration: 5000,
        });

        const resp =
          format === "pdf"
            ? await exportApi.triggerPdf(projectId)
            : await exportApi.triggerWebtoon(projectId);

        // 轮询状态
        const pollStatus = async (exportId: string): Promise<ExportResponse> => {
          const statusResp = await exportApi.getStatus(projectId!, exportId);
          if (statusResp.status === "processing") {
            await new Promise((r) => setTimeout(r, 2000));
            return pollStatus(exportId);
          }
          return statusResp;
        };

        const finalResp = await pollStatus(resp.export_id);

        if (finalResp.status === "completed" && finalResp.download_url) {
          const url = getStaticUrl(finalResp.download_url);
          toast.success({
            title: "导出完成",
            message: `${formatLabel}已生成`,
            duration: 8000,
            actions: url
              ? [
                  {
                    label: "下载",
                    onClick: () => {
                      window.open(url, "_blank");
                    },
                    variant: "primary",
                  },
                ]
              : undefined,
          });
        } else {
          toast.error({
            title: "导出失败",
            message: `${formatLabel}生成失败，请重试`,
            duration: 5000,
          });
        }
      } catch (e) {
        toast.error({
          title: "导出失败",
          message: `生成${formatLabel}时出错：${e instanceof Error ? e.message : "未知错误"}`,
          duration: 5000,
        });
      } finally {
        setExporting(null);
      }
    },
    [projectId],
  );

  return (
    <>
    <div
      className={`absolute bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border-3 border-base-content/25 bg-base-100 p-1.5 text-base-content shadow-comic sm:max-w-none sm:flex-nowrap ${className || ""}`}
    >
      {/* 选择工具 */}
      <div className="tooltip tooltip-top" data-tip="选择工具 (V)">
        <button
          type="button"
          className={`btn btn-sm btn-square ${
            currentTool === "select" ? "btn-primary" : "btn-ghost text-base-content"
          }`}
          onClick={handleSelectTool}
          aria-label="选择工具"
        >
          <CursorArrowRaysIcon className="w-5 h-5" />
        </button>
      </div>

      {/* 抓手工具 */}
      <div className="tooltip tooltip-top" data-tip="抓手工具 (H)">
        <button
          type="button"
          className={`btn btn-sm btn-square ${
            currentTool === "hand" ? "btn-primary" : "btn-ghost text-base-content"
          }`}
          onClick={handleHandTool}
          aria-label="抓手工具"
        >
          <HandRaisedIcon className="w-5 h-5" />
        </button>
      </div>

      {/* 分隔线 */}
      <div className="w-px h-6 bg-base-content/20 mx-1" />

      {/* 缩小 */}
      <div className="tooltip tooltip-top" data-tip="缩小">
        <button
          type="button"
          className="btn btn-sm btn-square btn-ghost text-base-content"
          onClick={handleZoomOut}
          aria-label="缩小"
        >
          <MagnifyingGlassMinusIcon className="w-5 h-5" />
        </button>
      </div>

      {/* 缩放百分比 */}
      <div className="tooltip tooltip-top" data-tip="重置缩放">
        <button
          type="button"
          className="btn btn-sm btn-ghost min-w-[60px] font-mono text-sm text-base-content"
          onClick={handleZoomReset}
          aria-label="重置缩放"
        >
          {zoomPercent}%
        </button>
      </div>

      {/* 放大 */}
      <div className="tooltip tooltip-top" data-tip="放大">
        <button
          type="button"
          className="btn btn-sm btn-square btn-ghost text-base-content"
          onClick={handleZoomIn}
          aria-label="放大"
        >
          <MagnifyingGlassPlusIcon className="w-5 h-5" />
        </button>
      </div>

      {/* 分隔线 */}
      <div className="w-px h-6 bg-base-content/20 mx-1" />

      {/* 适应视图 */}
      <div className="tooltip tooltip-top" data-tip="适应视图">
        <button
          type="button"
          className="btn btn-sm btn-square btn-ghost text-base-content"
          onClick={handleZoomToFit}
          aria-label="适应视图"
        >
          <ArrowsPointingOutIcon className="w-5 h-5" />
        </button>
      </div>

      {/* 导出按钮 */}
      {projectId && (
        <>
          <div className="w-px h-6 bg-base-content/20 mx-1" />
          <div className="relative" ref={exportMenuRef}>
            <div className="tooltip tooltip-top" data-tip="导出">
              <button
                type="button"
                className={`btn btn-sm btn-ghost text-base-content flex items-center gap-1 ${
                  exporting ? "loading" : ""
                }`}
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                aria-label="导出"
                disabled={!!exporting}
              >
                <ArrowDownTrayIcon className="w-5 h-5" />
                {exporting && (
                  <span className="text-xs">
                    {exporting === "pdf" ? "PDF" : "Webtoon"}...
                  </span>
                )}
              </button>
            </div>

            {/* 导出下拉菜单 */}
            {exportMenuOpen && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-base-100 border border-base-content/20 rounded-lg shadow-lg p-1 min-w-[160px] z-50">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost w-full justify-start text-base-content gap-2"
                  onClick={() => handleExport("pdf")}
                  disabled={!!exporting}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  导出 PDF 漫画册
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost w-full justify-start text-base-content gap-2"
                  onClick={() => handleExport("webtoon")}
                  disabled={!!exporting}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                    />
                  </svg>
                  导出 Webtoon 长图
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 一致性评估按钮 */}
      {projectId && (
        <>
          <div className="w-px h-6 bg-base-content/20 mx-1" />
          <div className="tooltip tooltip-top" data-tip="一致性评估">
            <button
              type="button"
              className="btn btn-sm btn-ghost text-base-content"
              onClick={() => setShowConsistency(true)}
              aria-label="一致性评估"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>

    {/* 一致性评估面板 */}
    {showConsistency && projectId && (
      <ConsistencyPanel
        projectId={projectId}
        onClose={() => setShowConsistency(false)}
      />
    )}
    </>
  );
});
