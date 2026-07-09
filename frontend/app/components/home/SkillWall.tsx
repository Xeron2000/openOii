import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { skillsApi } from "~/services/api";
import {
	SKILL_CATALOG,
	skillFromApi,
	type SkillPreset,
	type SkillBadge,
} from "~/features/skills/skillCatalog";

interface SkillWallProps {
	activeSkillId: string | null;
	onSelect: (skill: SkillPreset) => void;
	/** Optional externally-resolved catalog (Home may pass shared list) */
	skills?: SkillPreset[];
	/** Embedded in create desk: denser chips, no big section chrome */
	embedded?: boolean;
}

const ACCENT_BAR: Record<SkillPreset["accent"], string> = {
	primary: "bg-primary",
	secondary: "bg-secondary",
	accent: "bg-accent",
	info: "bg-info",
};

const ACCENT_RING: Record<SkillPreset["accent"], string> = {
	primary: "border-primary/50 bg-primary/5",
	secondary: "border-secondary/50 bg-secondary/5",
	accent: "border-accent/50 bg-accent/5",
	info: "border-info/50 bg-info/5",
};

function badgeLabel(badge: SkillBadge): string {
	if (badge === "new") return "NEW";
	return "核心";
}

export function SkillWall({
	activeSkillId,
	onSelect,
	skills,
	embedded = false,
}: SkillWallProps) {
	const { data: apiSkills } = useQuery({
		queryKey: ["skills"],
		queryFn: () => skillsApi.list(),
		staleTime: 60_000,
		enabled: !skills,
	});

	const catalog: SkillPreset[] =
		skills ??
		(apiSkills?.length
			? apiSkills.map((row, i) => skillFromApi(row, i))
			: SKILL_CATALOG);

	return (
		<section
			aria-labelledby="skill-wall-heading"
			className={clsx("w-full", embedded && "min-w-0")}
			data-shell="skill-wall"
			data-embedded={embedded ? "true" : undefined}
		>
			<div
				className={clsx(
					"flex items-baseline justify-between gap-2",
					embedded ? "mb-1.5" : "mb-[var(--space-2)]",
				)}
			>
				<h2
					id="skill-wall-heading"
					className={clsx(
						"m-0 font-heading font-bold leading-[var(--leading-tight)] tracking-tight text-pretty",
						embedded
							? "text-[length:var(--text-xs)] text-base-content/70"
							: "text-[length:var(--text-md)]",
					)}
				>
					{embedded ? "工作流" : "Skill · 点选开工"}
				</h2>
				<span className="font-mono text-[length:var(--text-2xs)] tabular-nums text-base-content/40">
					{catalog.length} 项
				</span>
			</div>

			<ul
				className={clsx(
					"m-0 grid list-none p-0",
					embedded
						? "grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-4"
						: "grid-cols-2 gap-[var(--space-2)] sm:grid-cols-3 lg:grid-cols-4",
				)}
			>
				{catalog.map((skill) => {
					const active = activeSkillId === skill.id;
					return (
						<li key={skill.id}>
							<button
								type="button"
								onClick={() => onSelect(skill)}
								aria-pressed={active}
								className={clsx(
									"group flex h-full w-full flex-col rounded-[var(--radius-md)] border-2 bg-base-100 text-left",
									"transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)]",
									"hover:-translate-y-px hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
									embedded
										? "min-h-[var(--touch-target-dense)] p-1.5"
										: "min-h-[var(--touch-target-dense)] p-[var(--space-2)]",
									active
										? clsx(ACCENT_RING[skill.accent], "shadow-brutal-sm")
										: "border-base-content/10",
								)}
							>
								{!embedded ? (
									<span
										className={clsx(
											"mb-1 block h-0.5 w-6 rounded-full",
											ACCENT_BAR[skill.accent],
										)}
										aria-hidden="true"
									/>
								) : null}
								<div className="flex items-start justify-between gap-1">
									<h3
										className={clsx(
											"m-0 font-heading font-bold leading-snug",
											embedded
												? "text-[length:var(--text-2xs)] sm:text-[length:var(--text-xs)]"
												: "text-[length:var(--text-sm)]",
										)}
									>
										{skill.title}
									</h3>
									{skill.badge && !embedded ? (
										<span className="shrink-0 rounded bg-primary/15 px-1 font-mono text-[length:var(--text-2xs)] font-bold uppercase leading-4 text-primary">
											{badgeLabel(skill.badge)}
										</span>
									) : null}
								</div>
								{!embedded ? (
									<p className="m-0 mt-1 line-clamp-2 text-[length:var(--text-2xs)] leading-snug text-base-content/55">
										{skill.description}
									</p>
								) : null}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
