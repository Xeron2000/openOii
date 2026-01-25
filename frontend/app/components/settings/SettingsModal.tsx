import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSettingsStore } from "~/stores/settingsStore";
import { configApi } from "~/services/api";
import type { ConfigItem, ConfigValue } from "~/types";
import { ConfigInput } from "./ConfigInput";
import { groupConfigs } from "~/utils/configGroups";
import {
  XMarkIcon,
  Cog6ToothIcon,
  InformationCircleIcon,
  CircleStackIcon,
  SparklesIcon,
  PhotoIcon,
  VideoCameraIcon,
  WrenchScrewdriverIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";

type AlertType = "success" | "error" | "warning";

interface AlertState {
  show: boolean;
  type: AlertType;
  title: string;
  message: string;
  details?: string;
}

export function SettingsModal() {
  const { isModalOpen, closeModal } = useSettingsStore();
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<Record<string, ConfigValue>>({});
  const [activeTab, setActiveTab] = useState("database");
  const [alertState, setAlertState] = useState<AlertState>({
    show: false,
    type: "success",
    title: "",
    message: "",
  });

  const { data: config, isLoading, isError } = useQuery({
    queryKey: ["config"],
    queryFn: configApi.get,
    enabled: isModalOpen,
  });

  useEffect(() => {
    if (config) {
      const initialState = config.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {} as Record<string, ConfigValue>);
      setFormState(initialState);
    }
  }, [config]);

  // 切换标签页
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  const updateMutation = useMutation({
    mutationFn: (newConfig: Record<string, ConfigValue>) => configApi.update(newConfig),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      // 不要立即关闭模态框，等用户点击确定后再关闭

      // 根据后端返回判断是否需要重启
      if (data?.restart_required) {
        const keys = data.restart_keys?.join(', ') || '';
        setAlertState({
          show: true,
          type: "warning",
          title: "配置已保存！",
          message: "其他配置已立即生效。",
          details: `以下配置需要重启服务才能生效：\n${keys}`,
        });
      } else {
        setAlertState({
          show: true,
          type: "success",
          title: "保存成功",
          message: "配置已保存并立即生效！",
        });
      }
    },
    onError: (error) => {
      setAlertState({
        show: true,
        type: "error",
        title: "保存失败",
        message: error.message,
      });
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormState(prevState => ({ ...prevState, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formState);
  };

  const handleCancel = () => {
    if (config) {
      const initialState = config.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {} as Record<string, ConfigValue>);
      setFormState(initialState);
    }
    closeModal();
  };

  if (!isModalOpen) {
    return null;
  }

  const sections = config ? groupConfigs(config) : [];

  // 标签页配置
  const tabConfig: Record<string, { icon: React.ReactNode; title: string; desc: string }> = {
    database: {
      icon: <CircleStackIcon className="w-4 h-4" />,
      title: "数据库",
      desc: "数据库和 Redis 连接配置"
    },
    llm: {
      icon: <SparklesIcon className="w-4 h-4" />,
      title: "LLM 服务",
      desc: "Claude / Anthropic API 配置"
    },
    image: {
      icon: <PhotoIcon className="w-4 h-4" />,
      title: "图像服务",
      desc: "图像生成服务配置（OpenAI 兼容接口）"
    },
    video: {
      icon: <VideoCameraIcon className="w-4 h-4" />,
      title: "视频服务",
      desc: "视频生成服务配置，支持 OpenAI 兼容接口和豆包"
    },
  };

  const activeSection = sections.find(s => s.key === activeTab);

  // 获取当前视频服务提供商
  const getVideoProvider = () => {
    return (formState['VIDEO_PROVIDER'] || formState['video_provider'] || 'doubao') as string;
  };

  // 渲染单个配置项
  const renderConfigItem = (item: ConfigItem) => (
    <div
      key={item.key}
      className="bg-base-200 p-4 rounded-lg border-2 border-black"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono font-bold text-sm">
          {item.key.toUpperCase()}
        </span>
        {item.is_sensitive && (
          <span className="badge badge-warning badge-xs">敏感</span>
        )}
        {item.source === 'env' && (
          <span className="badge badge-info badge-xs">仅.env</span>
        )}
      </div>
      <ConfigInput
        item={item}
        value={String(formState[item.key] ?? "")}
        onChange={handleInputChange}
      />
      <p className="text-xs text-base-content/60 mt-2">
        {getConfigDescription(item.key)}
      </p>
    </div>
  );

  // 渲染视频服务配置（特殊处理）
  const renderVideoSection = () => {
    if (!activeSection || activeTab !== 'video') return null;

    const videoProvider = getVideoProvider();

    // 分离配置项
    const providerItem = activeSection.items.find(i => i.key.toLowerCase() === 'video_provider');
    const commonItems = activeSection.items.filter(i =>
      ['video_image_mode', 'enable_image_to_video', 'video_inline_local_images'].includes(i.key.toLowerCase())
    );
    const openaiItems = activeSection.items.filter(i =>
      i.key.toLowerCase().startsWith('video_') &&
      !['video_provider', 'video_image_mode', 'enable_image_to_video', 'video_inline_local_images'].includes(i.key.toLowerCase())
    );
    const doubaoItems = activeSection.items.filter(i =>
      i.key.toLowerCase().startsWith('doubao_')
    );

    return (
      <div className="space-y-6">
        {/* 分类描述 */}
        <div className="flex items-center gap-2 text-sm text-info bg-info/10 px-4 py-2 rounded-lg border border-info/30">
          <InformationCircleIcon className="w-4 h-4 shrink-0" />
          <span>{tabConfig[activeTab]?.desc}</span>
        </div>

        {/* 服务提供商选择 */}
        {providerItem && (
          <div className="bg-base-200 p-4 rounded-lg border-2 border-black">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono font-bold text-sm">VIDEO_PROVIDER</span>
              <span className="badge badge-primary badge-xs">必选</span>
            </div>
            <div className="flex gap-4">
              <label className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${videoProvider === 'doubao'
                  ? 'border-accent bg-accent/10'
                  : 'border-black hover:bg-base-300'
                }
              `}>
                <input
                  type="radio"
                  name="VIDEO_PROVIDER"
                  value="doubao"
                  checked={videoProvider === 'doubao'}
                  onChange={handleInputChange}
                  className="radio radio-accent"
                />
                <div>
                  <div className="font-bold">豆包视频</div>
                  <div className="text-xs text-base-content/60">火山引擎 Ark API，国内推荐</div>
                </div>
              </label>
              <label className={`
                flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                ${videoProvider === 'openai'
                  ? 'border-accent bg-accent/10'
                  : 'border-black hover:bg-base-300'
                }
              `}>
                <input
                  type="radio"
                  name="VIDEO_PROVIDER"
                  value="openai"
                  checked={videoProvider === 'openai'}
                  onChange={handleInputChange}
                  className="radio radio-accent"
                />
                <div>
                  <div className="font-bold">OpenAI 兼容</div>
                  <div className="text-xs text-base-content/60">支持任何 OpenAI 兼容接口</div>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* 豆包配置 */}
        {videoProvider === 'doubao' && doubaoItems.length > 0 && (
          <div className="space-y-4">
            <h4 className="font-bold text-sm flex items-center gap-2 text-accent">
              <VideoCameraIcon className="w-4 h-4" />
              豆包视频配置
            </h4>
            <div className="space-y-4 pl-4 border-l-2 border-accent/30">
              {doubaoItems.map(renderConfigItem)}
            </div>
          </div>
        )}

        {/* OpenAI 兼容配置 */}
        {videoProvider === 'openai' && openaiItems.length > 0 && (
          <div className="space-y-4">
            <h4 className="font-bold text-sm flex items-center gap-2 text-accent">
              <VideoCameraIcon className="w-4 h-4" />
              OpenAI 兼容接口配置
            </h4>
            <div className="space-y-4 pl-4 border-l-2 border-accent/30">
              {openaiItems.map(renderConfigItem)}
            </div>
          </div>
        )}

        {/* 通用配置 */}
        {commonItems.length > 0 && (
          <div className="space-y-4">
            <h4 className="font-bold text-sm flex items-center gap-2 text-base-content/70">
              <WrenchScrewdriverIcon className="w-4 h-4" />
              通用配置
            </h4>
            <div className="space-y-4 pl-4 border-l-2 border-base-300">
              {commonItems.map(renderConfigItem)}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 渲染普通配置项列表
  const renderNormalSection = () => {
    if (!activeSection || activeTab === 'video') return null;

    return (
      <div className="space-y-4">
        {/* 分类描述 */}
        <div className="flex items-center gap-2 text-sm text-info bg-info/10 px-4 py-2 rounded-lg border border-info/30">
          <InformationCircleIcon className="w-4 h-4 shrink-0" />
          <span>{tabConfig[activeTab]?.desc}</span>
        </div>

        {/* 配置项列表 */}
        <div className="space-y-4">
          {activeSection.items.map(renderConfigItem)}
        </div>

        {/* 空状态 */}
        {activeSection.items.length === 0 && (
          <div className="text-center py-12 text-base-content/50">
            <InformationCircleIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>此分类暂无配置项</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box w-11/12 max-w-5xl max-h-[90vh] border-3 border-black shadow-brutal-lg bg-base-100 p-0 flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b-3 border-black bg-base-200 shrink-0">
          <h3 className="font-bold text-xl flex items-center gap-2">
            <Cog6ToothIcon className="w-6 h-6 text-accent" />
            环境变量配置管理
          </h3>
          <button onClick={handleCancel} className="btn btn-sm btn-ghost btn-circle">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center p-12">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        )}

        {isError && (
          <div className="p-6">
            <div role="alert" className="alert alert-error border-2 border-black">
              <ExclamationTriangleIcon className="w-6 h-6"/>
              <span>加载配置失败，请检查后端服务是否正常运行。</span>
            </div>
          </div>
        )}

        {config && (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            {/* 标签页导航 */}
            <div className="px-4 py-3 border-b-3 border-black bg-base-100 shrink-0">
              <div role="tablist" className="flex flex-wrap gap-2">
                {sections.map(section => {
                  const cfg = tabConfig[section.key];
                  const isActive = activeTab === section.key;
                  return (
                    <button
                      key={section.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleTabChange(section.key)}
                      className={`
                        flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                        border-2 border-black transition-all
                        ${isActive
                          ? 'bg-accent text-accent-content shadow-brutal'
                          : 'bg-base-200 hover:bg-base-300'
                        }
                      `}
                    >
                      {cfg?.icon}
                      <span>{cfg?.title || section.title}</span>
                      <span className={`
                        text-xs px-1.5 py-0.5 rounded
                        ${isActive ? 'bg-accent-content/20' : 'bg-base-300'}
                      `}>
                        {section.items.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 标签页内容 */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'video' ? renderVideoSection() : renderNormalSection()}
            </div>

            {/* 底部操作栏 */}
            <div className="border-t-3 border-black bg-base-200 px-6 py-4 flex items-center gap-4 shrink-0">
              <div className="flex items-center gap-2 text-info text-sm flex-1">
                <InformationCircleIcon className="w-5 h-5 shrink-0"/>
                <span>大部分配置保存后立即生效，数据库/Redis 配置需重启</span>
              </div>

              <button
                type="button"
                onClick={handleCancel}
                className="btn border-2 border-black"
              >
                取消
              </button>

              <button
                type="submit"
                className="btn btn-primary border-2 border-black"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending && <span className="loading loading-spinner loading-sm"></span>}
                保存配置
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Alert Modal */}
      {alertState.show && (
        <div className="modal modal-open">
          <div className="modal-box border-3 border-black shadow-brutal-lg">
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className={`shrink-0 ${
                alertState.type === "success" ? "text-success" :
                alertState.type === "error" ? "text-error" :
                "text-warning"
              }`}>
                {alertState.type === "success" ? (
                  <CheckCircleIcon className="w-8 h-8" />
                ) : (
                  <ExclamationCircleIcon className="w-8 h-8" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1">
                <h3 className="font-bold text-lg mb-2">{alertState.title}</h3>
                <p className="text-base-content/80">{alertState.message}</p>
                {alertState.details && (
                  <div className="mt-3 p-3 bg-base-200 rounded-lg border-2 border-black">
                    <p className="text-sm whitespace-pre-line">{alertState.details}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="modal-action">
              <button
                onClick={() => {
                  setAlertState({ ...alertState, show: false });
                  closeModal(); // 关闭设置模态框
                }}
                className="btn btn-primary border-2 border-black"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 配置项详细说明
function getConfigDescription(key: string): string {
  const descriptions: Record<string, string> = {
    // 基础设置
    APP_NAME: "应用名称，用于日志和服务标识",
    ENVIRONMENT: "运行环境：dev（开发）/ staging（预发布）/ prod（生产）",
    LOG_LEVEL: "日志级别：DEBUG / INFO / WARNING / ERROR",
    API_V1_PREFIX: "API 路由前缀，默认 /api/v1",
    CORS_ORIGINS: "跨域配置，JSON 数组格式，如 [\"http://localhost:3000\"]",

    // 数据库
    DATABASE_URL: "PostgreSQL 数据库连接字符串（asyncpg 协议）",
    DB_ECHO: "是否在控制台打印 SQL 语句（调试用）",
    REDIS_URL: "Redis 连接字符串，用于跨进程信号共享",

    // LLM 服务
    ANTHROPIC_API_KEY: "Anthropic 官方 API 密钥",
    ANTHROPIC_AUTH_TOKEN: "中转站 Token（国内推荐使用）",
    ANTHROPIC_BASE_URL: "API 基础地址（官方或中转站地址）",
    ANTHROPIC_MODEL: "Claude 模型名称，如 claude-sonnet-4-5-20250929",

    // 图像服务
    IMAGE_BASE_URL: "图像生成服务地址（OpenAI 兼容接口）",
    IMAGE_API_KEY: "图像生成 API 密钥",
    IMAGE_MODEL: "图像生成模型名称，如 dall-e-3",
    IMAGE_ENDPOINT: "图像生成 API 端点路径",
    ENABLE_IMAGE_TO_IMAGE: "是否启用图生图（I2I）功能",

    // 视频服务
    VIDEO_PROVIDER: "视频服务提供商：openai（OpenAI 兼容）/ doubao（豆包）",
    VIDEO_BASE_URL: "视频生成服务地址（OpenAI 兼容接口）",
    VIDEO_API_KEY: "视频生成 API 密钥",
    VIDEO_MODEL: "视频生成模型名称",
    VIDEO_ENDPOINT: "视频生成 API 端点路径",
    VIDEO_MODE: "视频生成模式：text（文生视频）或 image（图生视频）",
    ENABLE_IMAGE_TO_VIDEO: "是否启用图生视频（I2V）功能",

    // 豆包视频
    DOUBAO_API_KEY: "豆包 API 密钥（火山引擎 ARK_API_KEY）",
    DOUBAO_VIDEO_MODEL: "豆包视频模型 ID",
    DOUBAO_VIDEO_DURATION: "豆包视频时长：5 或 10（秒）",
    DOUBAO_VIDEO_RATIO: "豆包视频比例：16:9 / 9:16 / 1:1 / adaptive",
    DOUBAO_GENERATE_AUDIO: "豆包视频是否生成音频",
    VIDEO_IMAGE_MODE: "图生视频模式：first_frame（仅首帧）/ reference（拼接参考图）",
    VIDEO_INLINE_LOCAL_IMAGES: "未配置 PUBLIC_BASE_URL 时是否内联本地图片",

    // 其他
    REQUEST_TIMEOUT_S: "HTTP 请求超时时间（秒）",
    PUBLIC_BASE_URL: "对外可访问的后端地址，用于生成完整 URL",
    ADMIN_TOKEN: "管理员 Token，用于配置更新权限验证",
  };

  return descriptions[key.toUpperCase()] || "暂无说明";
}
