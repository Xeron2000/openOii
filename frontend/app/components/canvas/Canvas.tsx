import { useState } from "react";
import { useEditorStore } from "~/stores/editorStore";
import { ProjectOverview } from "./ProjectOverview";
import { FilmIcon, UserIcon } from "@heroicons/react/24/outline";
import { getStaticUrl } from "~/services/api";

interface CanvasProps {
  projectId: number;
}

export function Canvas({ projectId }: CanvasProps) {
  const { characters, shots, setSelectedShot, setSelectedCharacter } = useEditorStore();
  const [viewMode, setViewMode] = useState<"overview" | "characters" | "shots">("overview");

  return (
    <div className="flex flex-col h-full bg-base-200 rounded-lg p-4">
      {/* Header - 只保留 tabs */}
      <div className="mb-4 flex items-center">
        <div className="tabs tabs-boxed tabs-sm">
          <button
            className={`tab ${viewMode === "overview" ? "tab-active" : ""}`}
            onClick={() => setViewMode("overview")}
          >
            概览
          </button>
          <button
            className={`tab ${viewMode === "characters" ? "tab-active" : ""}`}
            onClick={() => setViewMode("characters")}
          >
            角色 ({characters.length})
          </button>
          <button
            className={`tab ${viewMode === "shots" ? "tab-active" : ""}`}
            onClick={() => setViewMode("shots")}
          >
            分镜 ({shots.length})
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-auto">
        {viewMode === "overview" && (
          <ProjectOverview projectId={projectId} />
        )}

        {viewMode === "characters" && (
          <div className="p-4 h-full">
            {characters.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-base-content/70">
                <div className="w-16 h-16 rounded-full bg-base-300/70 flex items-center justify-center mb-4">
                  <UserIcon className="w-6 h-6" aria-hidden="true" />
                </div>
                <p className="font-medium mb-1">暂无角色</p>
                <p className="text-sm text-center max-w-xs">AI 生成的角色设计将显示在这里</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {characters.map((char) => (
                  <div
                    key={char.id}
                    className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => setSelectedCharacter(char.id)}
                  >
                    <div className="card-body p-4">
                      <h3 className="card-title text-sm">{char.name}</h3>
                      {char.image_url ? (
                        <img
                          src={getStaticUrl(char.image_url)}
                          alt={char.name}
                          className="w-full h-32 object-contain rounded"
                        />
                      ) : (
                        <div className="w-full h-32 bg-base-300 rounded flex items-center justify-center">
                          <UserIcon className="w-6 h-6" aria-hidden="true" />
                        </div>
                      )}
                      <p className="text-xs text-base-content/80">
                        {char.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {viewMode === "shots" && (
          <div className="p-4 h-full">
            {shots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-base-content/70">
                <div className="w-16 h-16 rounded-full bg-base-300/70 flex items-center justify-center mb-4">
                  <FilmIcon className="w-6 h-6" aria-hidden="true" />
                </div>
                <p className="font-medium mb-1">暂无分镜</p>
                <p className="text-sm text-center max-w-xs">AI 生成的分镜画面将显示在这里</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {shots.map((shot) => {
                  const shotImageUrl = getStaticUrl(shot.image_url);
                  const shotVideoUrl = getStaticUrl(shot.video_url);
                  return (
                    <div
                      key={shot.id}
                      className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => setSelectedShot(shot.id)}
                    >
                      <div className="card-body p-4">
                        <h3 className="card-title text-sm">镜头 {shot.order}</h3>
                        {shotImageUrl && (
                          <img
                            src={shotImageUrl}
                            alt={`镜头 ${shot.order}`}
                            className="w-full h-32 object-contain rounded"
                          />
                        )}
                        {shotVideoUrl && (
                          <div className="relative mt-2">
                            <video
                              src={shotVideoUrl}
                              className="w-full h-32 object-cover rounded"
                              muted
                              loop
                              onMouseEnter={(e) => e.currentTarget.play()}
                              onMouseLeave={(e) => {
                                e.currentTarget.pause();
                                e.currentTarget.currentTime = 0;
                              }}
                            />
                            <div className="badge badge-success badge-xs absolute top-1 right-1 text-success-content">视频</div>
                          </div>
                        )}
                        {!shotImageUrl && !shotVideoUrl && (
                          <div className="w-full h-32 bg-base-300 rounded flex items-center justify-center">
                            <FilmIcon className="w-6 h-6" aria-hidden="true" />
                          </div>
                        )}
                        <p className="text-xs text-base-content/80">
                          {shot.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
