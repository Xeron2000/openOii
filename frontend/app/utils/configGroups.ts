import type { ConfigItem } from "~/types";

export interface ConfigSection {
  key: string;
  title: string;
  items: ConfigItem[];
}

export function groupConfigs(configs: ConfigItem[]): ConfigSection[] {
  const groups: Record<string, ConfigItem[]> = {
    database: [],
    llm: [],
    image: [],
    video: [],
  };

  configs.forEach((config) => {
    const key = config.key.toLowerCase();

    // 数据库配置
    if (key.startsWith("database_") || key.startsWith("redis_") || key.startsWith("db_")) {
      groups.database.push(config);
    }
    // LLM 服务配置
    else if (key.startsWith("anthropic_")) {
      groups.llm.push(config);
    }
    // 图像服务配置
    else if (key.startsWith("image_") || key === "enable_image_to_image") {
      groups.image.push(config);
    }
    // 视频服务配置
    else if (
      key.startsWith("video_") ||
      key.startsWith("doubao_") ||
      key === "enable_image_to_video"
    ) {
      groups.video.push(config);
    }
    // 其他配置项忽略（基础设置、其他设置不显示）
  });

  return [
    { key: "database", title: "数据库配置", items: groups.database },
    { key: "llm", title: "LLM 服务", items: groups.llm },
    { key: "image", title: "图像生成服务", items: groups.image },
    { key: "video", title: "视频服务", items: groups.video },
  ].filter((section) => section.items.length > 0); // 过滤空分组
}
