import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "~/services/api";
import { Layout } from "~/components/layout/Layout";
import { Card } from "~/components/ui/Card";
import { ConfirmModal } from "~/components/ui/ConfirmModal";
import {
  DocumentTextIcon,
  FaceFrownIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

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
    mutationFn: (id: number) => projectsApi.delete(id),
    onSuccess: (_, deletedId) => {
      // 清理项目列表缓存
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // 移除该项目的所有相关缓存，防止 ID 复用时命中旧缓存
      queryClient.removeQueries({ queryKey: ["project", deletedId] });
      queryClient.removeQueries({ queryKey: ["characters", deletedId] });
      queryClient.removeQueries({ queryKey: ["scenes", deletedId] });
      queryClient.removeQueries({ queryKey: ["shots", deletedId] });
      queryClient.removeQueries({ queryKey: ["messages", deletedId] });
      setDeleteTarget(null);
      toast.success({
        title: "删除成功",
        message: "项目已删除",
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
    setDeleteTarget(id);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget !== null) {
      deleteMutation.mutate(deleteTarget);
    }
  };

  return (
    <Layout>
      <div className="min-h-screen flex flex-col">
        <header className="bg-base-100 border-b-3 border-black px-6 py-4">
          <h1 className="text-2xl font-heading font-bold">
            <span className="underline-sketch">全部项目</span>
          </h1>
        </header>

        <main className="flex-1 px-6 py-8">
          <div className="max-w-3xl mx-auto">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <PencilIcon className="w-6 h-6 animate-bounce" aria-hidden="true" />
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
              <div className="grid gap-3">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    to={`/project/${project.id}`}
                    className="block"
                  >
                    <Card className="group transition-transform duration-200 hover:-translate-y-1 cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-heading font-bold truncate">
                              {project.title}
                            </span>
                            <span
                              className={`badge badge-sm font-bold ${
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
                          className="p-2 opacity-0 group-hover:opacity-100 hover:bg-error/20 rounded-lg transition-all cursor-pointer"
                          onClick={(e) => handleDeleteClick(project.id, e)}
                          title="删除"
                        >
                          <TrashIcon className="w-5 h-5 text-error" />
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
        message="确定要删除这个项目吗？删除后将无法恢复。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </Layout>
  );
}
