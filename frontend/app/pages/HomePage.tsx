import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "~/services/api";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { Layout } from "~/components/layout/Layout";
import { FilmIcon, SparklesIcon } from "@heroicons/react/24/outline";

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [story, setStory] = useState("");
  const [isComposing, setIsComposing] = useState(false);

  const createMutation = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/project/${project.id}?autoStart=true`);
    },
  });

  const handleSubmit = () => {
    const trimmed = story.trim();
    if (!trimmed || createMutation.isPending) return;

    const firstLine = trimmed.split("\n")[0] || "";
    const title =
      firstLine.length > 20 ? `${firstLine.slice(0, 20)}...` : firstLine;

    createMutation.mutate({
      title: title || "未命名项目",
      story: trimmed,
      style: "cinematic",
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Layout>
      <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
        {/* Main Content */}
        <main className="w-full max-w-3xl mx-auto">
          {/* Logo / title */}
          <div className="text-center mb-10 animate-bounce-in">
            <h1 className="text-5xl sm:text-6xl font-heading font-bold mb-2 relative inline-block">
              <span className="text-primary absolute -top-4 -left-6 text-3xl transform -rotate-12 animate-wiggle">
                <FilmIcon className="w-6 h-6" aria-hidden="true" />
              </span>
              <span className="underline-sketch">openOii</span>
              <span className="text-secondary absolute -bottom-4 -right-6 text-3xl transform rotate-12 animate-wiggle">
                <SparklesIcon className="w-6 h-6" aria-hidden="true" />
              </span>
            </h1>
            <p className="text-base-content/80 font-sketch text-lg mt-4">
              用 AI Agent 将你的故事转化为动漫视频
            </p>
          </div>

          {/* Input Card */}
          <Card
            className="w-full animate-bounce-in"
            style={{ animationDelay: "100ms" }}
          >
            <div className="relative">
              <textarea
                className="input-doodle w-full h-36 text-base resize-none p-4 pr-16"
                placeholder={
                  "讲述一个精彩的故事吧！\n\n例如：一只梦想成为宇航员的猫，偷偷登上了火箭..."
                }
                value={story}
                onChange={(e) => setStory(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                disabled={createMutation.isPending}
              />
              <Button
                variant="primary"
                size="sm"
                className="absolute right-3 bottom-3 rounded-full !p-2"
                onClick={handleSubmit}
                disabled={!story.trim() || createMutation.isPending}
                loading={createMutation.isPending}
                title="开始生成 (Enter)"
              >
                {!createMutation.isPending && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5"
                  >
                    <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                  </svg>
                )}
              </Button>
            </div>
            <p className="text-xs text-base-content/50 mt-2 text-center font-sketch">
              按 Enter 发送，Shift + Enter 换行
            </p>
          </Card>

          {/* 提示文字 */}
          <p className="text-center text-sm text-base-content/50 mt-8 animate-bounce-in" style={{ animationDelay: "200ms" }}>
            历史记录在左侧边栏中查看 ←
          </p>
        </main>
      </div>
    </Layout>
  );
}
