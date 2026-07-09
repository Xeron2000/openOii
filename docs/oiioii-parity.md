# OiiOii ↔ openOii 功能差距与复刻路线

> 状态：Phase 0–5a + LangGraph + redesign **已完成**；Skills / Reimagine / 选中局部重做 **已加深实现**（非空壳 catalog）  
> 原则：复刻 **产品原语**，不 1:1 抄 UI / 不追闭源模型护城河。

## 产品原语对照

| 原语 | OiiOii 2.0（公开） | openOii 现状 | 目标 |
|------|-------------------|--------------|------|
| Agent 团队流水线 | ~7 类专家接力 | Outline/Plan/Render/Compose/Critic | 保留并扩展场景/艺术总监角色 |
| 无限画布 | 智能画布，素材可点选唤 Agent | tldraw comic-workflow | 选中绑定对话 + 局部重做 |
| Skill 库 | 行业工作流可挂载 | 无 | 配置化 skill presets |
| 拉片复刻 | 上传视频 → 约 18 维拉片 | 无 | Phase 4 近似实现 |
| 托管 / 对话 | 两种模式 | review / quick | 产品化文案与入口 |
| 资产复用 | 角色/IP 资产 | Universe + Asset + StyleTemplate | 强化跨项目 |
| 成片合成 | 视频 + BGM + 剪辑 | compose + audio | 产品化导出 |

## 分阶段

| Phase | 范围 | 状态 |
|-------|------|------|
| 0 | 差距文档 + 设计对齐 | ✅ |
| 1 | 首页 Skill 墙 + 项目页导演台布局 + token 收紧 | ✅ |
| 2 | 画布选中 ↔ Agent 上下文 + feedback_entity feedback | ✅ |
| 3 | Skill schema + catalog API 驱动编排入口 | ✅ **深度**：`Project.skill_id` 持久化、directives 注入 outline/plan、默认镜头数/模式 |
| 4 | 拉片复刻（文本 brief 18 维 + 槽位替换） | ✅ **深度**：LLM keyword-only 修复、维度 UI、`reimagine_meta` 落库 |
| 5a | 九宫格分镜 + 单格重做 | ✅ **深度**：feedback 应用 `target_ids`、scoped cleanup、反馈进 render prompt |
| 5b | 场景 Agent / 真视频上传多模态 / 画布图编 | 默认不做 |

### LangGraph 架构（2026 对齐）

- HITL：`interrupt()` in approval nodes + `Command(resume=…)` only
- Driver：`app/orchestration/driver.py` 抽出 interrupt 循环
- State：`skill_id` / `focus_entity_*` 写入 Phase2State
- Skills：`app/skills/catalog.py` + `context.py` → `/api/v1/skills`；FE 以 API 为 SSOT
- Reimagine：`app/services/reimagine.py` → `/api/v1/reimagine/analyze`
- Selection：review `target_ids` → orchestrator cleanup/render 局部重跑  
  - 反馈语义路由：对白/设定 → plan；画面/光色 → render；运镜/视频 → compose  
  - resume 继承 `project.skill_id`；compose/render 注入实体反馈

## 明确不做（近端）

- 像素级复制 OiiOii 官网 UI
- 闭源视频模型供应链与积分体系
- 运营级 200+ 风格 / 全量行业 Skill 库存
- 完整移动端导演台

## 前端信息架构（Phase 1）

```
Home
  导演问候 + 一句话开工
  Skill / 模板墙（配置驱动）
  最近入口：项目 / 资产 / 宇宙

Project（导演台）
  TopBar + StagePipeline
  ┌ Agent Rail │ Canvas │ Workspace Sidebar ┐
  │ 任务/阶段   │ tldraw │ Chat / Inspector  │
  │ 选中上下文  │        │ Assets            │
  └────────────┴────────┴───────────────────┘
```

## Design Read

- **Page kind:** 创意生产工具（canvas-first product UI）
- **Audience:** 独立漫剧创作者
- **Vibe:** Comic Workbench（印刷工位 × 导演台）
- **Dials:** VARIANCE 6 / MOTION 4 / DENSITY 6
- **Anti-slop:** 禁止紫渐变 AI 默认、禁止冷灰 SaaS 三栏照搬
