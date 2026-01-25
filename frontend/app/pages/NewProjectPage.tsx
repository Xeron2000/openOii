import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { projectsApi } from "~/services/api";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Card } from "~/components/ui/Card";
import {
  BookOpenIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  FilmIcon,
  PaintBrushIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";

export function NewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    title: "",
    story: "",
    style: "cinematic",
  });

  const createMutation = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success({
        title: "创建成功",
        message: "项目已创建，正在跳转...",
      });
      // 自动开始生成
      navigate(`/project/${project.id}?autoStart=true`);
    },
    onError: (error: Error | ApiError) => {
      const apiError = error instanceof ApiError ? error : null;
      toast.error({
        title: "创建失败",
        message: apiError?.message || error.message || "未知错误",
        actions: [
          {
            label: "重试",
            onClick: () => createMutation.mutate(formData),
          },
        ],
      });
    },
  });

  const handleSubmit = () => {
    if (!formData.title.trim()) return;
    createMutation.mutate(formData);
  };

  const styles = [
    { id: "cinematic", name: "电影风格", icon: FilmIcon },
    { id: "anime", name: "动漫风格", icon: SparklesIcon },
    { id: "comic", name: "漫画风格", icon: BookOpenIcon },
    { id: "watercolor", name: "水彩风格", icon: PaintBrushIcon },
  ];

  const selectedStyle = styles.find((s) => s.id === formData.style);

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <header className="navbar bg-base-200 border-b border-base-300">
        <div className="flex-1">
          <Link to="/" className="btn btn-ghost">
            ← 返回
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Progress steps */}
        <ul className="steps steps-horizontal w-full mb-8">
          <li className={`step ${step >= 1 ? "step-primary" : ""}`}>故事</li>
          <li className={`step ${step >= 2 ? "step-primary" : ""}`}>风格</li>
          <li className={`step ${step >= 3 ? "step-primary" : ""}`}>确认</li>
        </ul>

        {/* Step 1: Story */}
        {step === 1 && (
          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <DocumentTextIcon className="w-5 h-5" aria-hidden="true" />
                <span className="underline-sketch">讲述你的故事</span>
              </span>
            }
          >
            <div className="space-y-4">
              <Input
                label="项目标题"
                placeholder="我的精彩故事"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
              />
              <div className="form-control">
                <label className="label">
                  <span className="label-text">故事内容</span>
                </label>
                <textarea
                  className="textarea textarea-bordered bg-base-200 h-48"
                  placeholder="很久很久以前..."
                  value={formData.story}
                  onChange={(e) =>
                    setFormData({ ...formData, story: e.target.value })
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!formData.title.trim()}
                >
                  下一步 →
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Step 2: Style */}
        {step === 2 && (
          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <PaintBrushIcon className="w-5 h-5" aria-hidden="true" />
                <span className="underline-sketch">选择风格</span>
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-4 mb-6">
              {styles.map((style) => {
                const StyleIcon = style.icon;
                return (
                  <button
                    key={style.id}
                    className={`card bg-base-300 p-6 text-center transition-all hover:scale-105 ${
                      formData.style === style.id
                        ? "ring-2 ring-primary"
                        : ""
                    }`}
                    onClick={() => setFormData({ ...formData, style: style.id })}
                  >
                    <StyleIcon className="w-6 h-6 mx-auto mb-2" aria-hidden="true" />
                    <span className="font-medium">{style.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                ← 返回
              </Button>
              <Button onClick={() => setStep(3)}>下一步 →</Button>
            </div>
          </Card>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <CheckCircleIcon className="w-5 h-5" aria-hidden="true" />
                <span className="underline-sketch">确认项目</span>
              </span>
            }
          >
            <div className="space-y-4">
              <div className="bg-base-300 rounded-lg p-4">
                <h3 className="font-semibold text-lg">{formData.title}</h3>
                <div className="badge badge-outline mt-2 flex items-center gap-2 text-base-content">
                  {selectedStyle && (
                    <>
                      <selectedStyle.icon className="w-5 h-5" aria-hidden="true" />
                      {selectedStyle.name}
                    </>
                  )}
                </div>
                {formData.story && (
                  <p className="text-sm text-base-content/70 mt-3 line-clamp-4">
                    {formData.story}
                  </p>
                )}
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  ← 返回
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  loading={createMutation.isPending}
                >
                  创建项目
                </Button>
              </div>
            </div>
          </Card>
        )}

        {createMutation.isError && (
          <div className="alert alert-error mt-4">
            <span>创建项目失败，请重试。</span>
          </div>
        )}
      </main>
    </div>
  );
}
