import { lazy, Suspense } from "react";

interface StageViewProps {
  projectId: number;
  onSelectedNodeIdChange?: (nodeId: string | null) => void;
}

const InfiniteCanvas = lazy(() =>
  import("~/components/canvas/InfiniteCanvas").then((m) => ({
    default: m.InfiniteCanvas,
  })),
);

export function StageView({ projectId, onSelectedNodeIdChange }: StageViewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-base-100 text-sm text-base-content/60">
          正在加载画布...
        </div>
      }
    >
      <InfiniteCanvas
        key={projectId}
        projectId={projectId}
        onSelectedNodeIdChange={onSelectedNodeIdChange}
      />
    </Suspense>
  );
}
