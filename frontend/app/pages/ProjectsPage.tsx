import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "~/services/api";
import { Card } from "~/components/ui/Card";
import { ConfirmModal } from "~/components/ui/ConfirmModal";
import {
	DocumentTextIcon,
	FaceFrownIcon,
	PencilIcon,
	TrashIcon,
	Cog6ToothIcon,
	MoonIcon,
	SunIcon,
} from "@heroicons/react/24/outline";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";
import { cleanupDeletedProjectCaches } from "~/features/projects/deleteProject";
import { useThemeStore } from "~/stores/themeStore";
import { useSettingsStore } from "~/stores/settingsStore";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<number[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { theme, toggleTheme } = useThemeStore();
  const isDark = theme.endsWith("dark");
  const { openModal: openSettingsModal } = useSettingsStore();

  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
    retry: 1,
  });

  // 显示加载错误
  useEffect(() => {
    if (error) {
      const apiError = error instanceof ApiError ? error : null;
      toast.error({
        title: "加载项目列表失败",
        message: apiError?.message || "无法获取项目列表",
        actions: [
          {
            label: "重试",
            onClick: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
          },
        ],
      });
    }
  }, [error, queryClient]);

  const deleteMutation = useMutation({
    mutationFn: (ids: number[]) => projectsApi.deleteMany(ids),
    onSuccess: (_, deletedIds) => {
      cleanupDeletedProjectCaches(queryClient, deletedIds);
      setSelectedIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
      setDeleteTarget(null);
      toast.success({
        title: "删除成功",
        message: deletedIds.length > 1 ? "项目已批量删除" : "项目已删除",
      });
    },
    onError: (error: Error | ApiError) => {
      const apiError = error instanceof ApiError ? error : null;
      toast.error({
        title: "删除失败",
        message: apiError?.message || error.message || "未知错误",
      });
    },
  });

  const handleDeleteClick = (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleteMutation.isPending) return;
    setDeleteTarget([id]);
  };

  const handleBatchDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (deleteMutation.isPending || selectedIds.length === 0) return;
    setDeleteTarget([...selectedIds]);
  };

  const handleToggleSelect = (projectId: number, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, projectId] : prev.filter((id) => id !== projectId)
    );
  };

  const handleToggleSelectAll = (checked: boolean) => {
    if (!projects) return;
    setSelectedIds(checked ? projects.map((project) => project.id) : []);
  };

  const allSelected = projects && projects.length > 0 && selectedIds.length === projects.length;

  const handleConfirmDelete = () => {
    if (deleteTarget !== null && deleteTarget.length > 0) {
      deleteMutation.mutate(deleteTarget);
    }
  };

  return (
    <div className="min-h-screen bg-base-100 font-sans">
      <header className="flex items-center justify-between px-4 h-10 border-b border-base-content/10">
        <Link to="/" className="font-comic text-lg text-primary font-bold tracking-wider">openOii</Link>
        <div className="flex items-center gap-1">
          <Link to="/" className="btn btn-ghost btn-xs !px-1 !min-h-0 !h-6 text-xs">新建</Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost btn-xs !px-1 !min-h-0 !h-6"
            aria-label={isDark ? "切换亮色" : "切换暗色"}
          >
            {isDark ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={openSettingsModal}
            className="btn btn-ghost btn-xs !px-1 !min-h-0 !h-6"
            aria-label="设置"
          >
            <Cog6ToothIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>
      <div className="flex flex-col min-h-[calc(100vh-40px)]">
        <header className="bg-base-100 border-b-3 border-base-content/30 px-4 py-4 sm:px-6">
          <h1 className="text-2xl font-heading font-bold">
            <span className="underline-sketch">全部项目</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(allSelected)}
                onChange={(e) => handleToggleSelectAll(e.target.checked)}
                disabled={!projects || projects.length === 0}
                className="mr-2 align-middle"
              />
              全选
            </label>
            <button
              type="button"
              className="btn btn-sm btn-error"
              onClick={handleBatchDeleteClick}
              disabled={selectedIds.length === 0}
            >
              批量删除（{selectedIds.length}）
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 sm:px-6">
          <div className="mx-auto w-full max-w-3xl min-w-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <PencilIcon className="w-6 h-6 animate-pulse" aria-hidden="true" />
                <p className="font-sketch text-lg text-base-content/70">加载中...</p>
              </div>
            ) : error ? (
              <Card className="text-center py-8">
                <FaceFrownIcon className="w-6 h-6 mx-auto mb-4" aria-hidden="true" />
                <p className="text-error font-bold">加载项目失败，请重试。</p>
              </Card>
            ) : !projects || projects.length === 0 ? (
              <Card className="text-center py-12">
                <DocumentTextIcon className="w-6 h-6 mx-auto mb-4" aria-hidden="true" />
                <p className="text-lg font-heading font-bold mb-2">暂无项目</p>
                <p className="text-base-content/60">开始创作你的第一个故事吧！</p>
              </Card>
            ) : (
              <div className="grid min-w-0 gap-3">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    to={`/project/${project.id}`}
                    className="block min-w-0 max-w-full"
                  >
                    <Card className="group min-w-0 overflow-hidden !p-4 transition-transform duration-200 hover:-translate-y-1 cursor-pointer sm:!p-6">
                      <div className="flex min-w-0 items-center gap-2">
                        <label
                          className="shrink-0 cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`选择项目 ${project.title}`}
                            checked={selectedIds.includes(project.id)}
                            onChange={(e) => handleToggleSelect(project.id, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          />
                        </label>
                        <div className="flex-1 min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="block min-w-0 flex-1 truncate font-heading font-bold">
                              {project.title}
                            </span>
                            <span
                              className={`badge badge-sm shrink-0 font-bold ${
                                project.status === "ready"
                                  ? "bg-success/20 text-success-content"
                                  : project.status === "processing"
                                    ? "bg-warning/20 text-warning-content animate-pulse"
                                    : "bg-neutral/20"
                              }`}
                            >
                              {project.status}
                            </span>
                          </div>
                          {project.story && (
                            <p className="text-sm text-base-content/60 truncate mt-1">
                              {project.story}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-lg p-2 opacity-100 transition-all cursor-pointer hover:bg-error/20 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                          onClick={(e) => handleDeleteClick(project.id, e)}
                          aria-label={`删除项目 ${project.title}`}
                          title="删除"
                        >
                          <TrashIcon className="w-5 h-5 text-error" aria-hidden="true" />
                        </button>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="删除项目"
        message={`确定要删除选中的${deleteTarget ? deleteTarget.length : 0}个项目吗？删除后将无法恢复。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
