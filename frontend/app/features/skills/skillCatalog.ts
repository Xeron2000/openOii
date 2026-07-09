/**
 * Simple production skills — fallback when /api/v1/skills is offline.
 * Keep in sync with backend app/skills/catalog.py (no 拉片/广告等实验流).
 */

export type SkillBadge = "new" | "core";

export interface SkillPreset {
	id: string;
	title: string;
	description: string;
	accent: "primary" | "secondary" | "accent" | "info";
	badge?: SkillBadge;
	prefill: {
		style?: string;
		creationMode?: "review" | "quick";
		placeholder?: string;
		storyHint?: string;
		storyTemplate?: string;
		targetShotCount?: number;
	};
	directives?: string;
	available: boolean;
}

const ACCENT_CYCLE: SkillPreset["accent"][] = [
	"primary",
	"secondary",
	"accent",
	"info",
];

export function skillFromApi(
	row: {
		id: string;
		title: string;
		description: string;
		badge?: string | null;
		prefer_auto_mode?: boolean;
		default_style?: string | null;
		default_creation_mode?: string | null;
		default_target_shot_count?: number | null;
		story_prefix?: string;
		story_template?: string;
		directives?: string;
		placeholder?: string;
		available?: boolean;
	},
	index = 0,
): SkillPreset {
	const badge = row.badge === "core" || row.badge === "new" ? row.badge : undefined;
	const creationMode =
		row.default_creation_mode === "quick" || row.prefer_auto_mode
			? "quick"
			: row.default_creation_mode === "review"
				? "review"
				: undefined;
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		accent: ACCENT_CYCLE[index % ACCENT_CYCLE.length],
		badge,
		prefill: {
			style: row.default_style ?? undefined,
			creationMode,
			placeholder: row.placeholder || row.description,
			storyHint: row.story_prefix || "",
			storyTemplate: row.story_template || "",
			targetShotCount: row.default_target_shot_count ?? undefined,
		},
		directives: row.directives,
		available: row.available !== false,
	};
}

export const SKILL_CATALOG: SkillPreset[] = [
	{
		id: "story-anime",
		title: "剧情故事",
		description: "一句话开故事：大纲 → 角色 → 分镜 → 成片。",
		accent: "primary",
		badge: "core",
		prefill: {
			style: "anime",
			creationMode: "review",
			placeholder: "主角是谁？想要什么？最大阻碍是什么？结尾情绪？",
			storyTemplate:
				"主角：\n目标：\n冲突：\n关键画面（3 帧）：\n1. \n2. \n3. \n风格/情绪：\n",
			targetShotCount: 8,
		},
		available: true,
	},
	{
		id: "character-design",
		title: "角色设计",
		description: "先做稳人设与形象，再用少量镜头验收。",
		accent: "secondary",
		badge: "core",
		prefill: {
			style: "anime",
			creationMode: "review",
			placeholder: "外貌、性格、标志道具、出场情绪、和谁互动？",
			storyHint: "【角色设计】\n",
			storyTemplate:
				"【角色设计】\n角色名：\n年龄/身份：\n外貌（发型发色、瞳色、体型、服装、标志物）：\n性格与说话方式：\n关系（对手/同伴）：\n想用 2–4 个镜头展示的瞬间：\n",
			targetShotCount: 4,
		},
		available: true,
	},
	{
		id: "script-breakdown",
		title: "剧本拆分",
		description: "粘贴剧本/分场，拆成可审阅分镜清单。",
		accent: "accent",
		badge: "core",
		prefill: {
			style: "cinematic",
			creationMode: "review",
			placeholder: "粘贴完整剧本、分场大纲或场次表。",
			storyHint: "【剧本拆分】\n",
			storyTemplate:
				"【剧本拆分】\n（在下方粘贴剧本或分场）\n\n场次/镜号（如有）：\n必须保留的对白：\n可省略的过场：\n",
		},
		available: true,
	},
	{
		id: "quick-short",
		title: "快速成片",
		description: "少打断自动跑通，适合草稿验证。",
		accent: "info",
		badge: "core",
		prefill: {
			style: "anime",
			creationMode: "quick",
			placeholder: "一句话短片点子（角色 + 冲突 + 结局）。",
			storyTemplate: "一句话点子：\n主角：\n冲突/反转：\n结局：\n",
			targetShotCount: 5,
		},
		available: true,
	},
	{
		id: "scene-design",
		title: "场景分镜",
		description: "先写清空间与光影，再挂角色走位。",
		accent: "primary",
		badge: "core",
		prefill: {
			style: "donghua",
			creationMode: "review",
			placeholder: "时代、地点、天气、光线、关键道具与想拍的走位。",
			storyHint: "【场景分镜】\n",
			storyTemplate:
				"【场景分镜】\n地点：\n时代/氛围：\n天气与光线：\n关键道具/建筑：\n镜头想逛的路径（远→近 / 环绕 / 跟拍）：\n出场角色（可少）：\n",
			targetShotCount: 6,
		},
		available: true,
	},
	{
		id: "comedy-pet",
		title: "萌宠搞笑",
		description: "短平快反转，适合萌宠/沙雕桥段。",
		accent: "info",
		badge: "core",
		prefill: {
			style: "pixar",
			creationMode: "quick",
			placeholder: "宠物/搞笑桥段一句话，最好带反转。",
			storyTemplate: "宠物/角色：\n搞笑设定：\n反转/笑点：\n结局画面：\n",
			targetShotCount: 5,
		},
		available: true,
	},
];

export function getSkillById(
	id: string,
	catalog: SkillPreset[] = SKILL_CATALOG,
): SkillPreset | undefined {
	return catalog.find((skill) => skill.id === id);
}
