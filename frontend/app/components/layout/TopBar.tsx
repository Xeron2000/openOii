import {
	Cog6ToothIcon,
	FilmIcon,
	PlusIcon,
	ChevronDownIcon,
	MoonIcon,
	SunIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "~/services/api";
import { useThemeStore } from "~/stores/themeStore";
import { useSettingsStore } from "~/stores/settingsStore";
import type { Project } from "~/types";
import { Button } from "~/components/ui/Button";

interface TopBarProps {
	projectId?: number;
}

function ProjectDropdown({ currentId }: { currentId?: number }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const { data: projects } = useQuery({
		queryKey: ["projects"],
		queryFn: () => projectsApi.list(),
	});

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		if (open) document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	const list = (projects ?? []) as Project[];

	return (
		<div className="relative min-w-0" ref={ref}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex h-11 max-w-[132px] items-center gap-1.5 rounded-lg px-2 text-sm font-heading font-bold transition-colors hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:max-w-[220px]"
				aria-expanded={open}
				aria-haspopup="true"
			>
				<FilmIcon className="h-4 w-4 flex-shrink-0 text-primary" />
				<span className="truncate">{list.find((p) => p.id === currentId)?.title || "项目"}</span>
				<ChevronDownIcon className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>

			{open && (
				<div className="absolute left-0 top-full mt-1 w-64 bg-base-200 border-2 border-base-content/15 rounded-lg shadow-comic z-50 py-1 max-h-80 overflow-y-auto">
					<Link
						to="/"
						onClick={() => setOpen(false)}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-base-content/60 hover:bg-base-300 transition-colors"
					>
						<SparklesIcon className="w-3 h-3" />
						首页 — 所有项目
					</Link>
					<div className="border-t border-base-content/10 my-1" />
					{list.map((p) => {
						const statusMap: Record<string, { label: string; cls: string }> = {
							draft: { label: "草稿", cls: "text-base-content/70" },
							planning: { label: "规划中", cls: "text-base-content" },
							ready: { label: "完成", cls: "text-base-content" },
							superseded: { label: "已覆盖", cls: "text-base-content/70" },
						};
						const st = statusMap[p.status] ?? { label: p.status, cls: "text-base-content/70" };
						return (
							<Link
								key={p.id}
								to={`/project/${p.id}`}
								onClick={() => setOpen(false)}
								className={`flex items-center justify-between px-3 py-1.5 text-xs hover:bg-base-300 transition-colors group ${p.id === currentId ? "bg-primary/10 text-primary font-bold" : ""}`}
							>
								<span className="truncate flex-1">{p.title}</span>
								<span className={`text-[10px] ml-1.5 flex-shrink-0 ${st.cls}`}>{st.label}</span>
							</Link>
						);
					})}
					<div className="border-t border-base-content/10 my-1" />
					<Link
						to="/"
						onClick={() => setOpen(false)}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary hover:bg-base-300 transition-colors"
					>
						<PlusIcon className="w-3 h-3" />
						新建项目
					</Link>
				</div>
			)}
		</div>
	);
}

export function TopBar({
	projectId,
}: TopBarProps) {
	const { theme, toggleTheme } = useThemeStore();
	const isDark = theme.endsWith("dark");
	const { openModal: openSettingsModal } = useSettingsStore();

	const btnCls = "flex items-center whitespace-nowrap gap-1.5 !px-2.5";
	const iconCls = "h-4 w-4";

	return (
		<header className="z-30 flex min-h-14 flex-shrink-0 items-center gap-2 border-b-2 border-base-content/15 bg-base-100 px-3 sm:gap-3 sm:px-4">
			<div className="flex min-w-0 items-center gap-2">
				{projectId ? (
					<ProjectDropdown currentId={projectId} />
				) : (
					<Link to="/" className="inline-flex h-11 items-center rounded-lg px-1 font-comic text-xl font-bold tracking-wider text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
						openOii
					</Link>
				)}
			</div>

			<div className="min-w-0 flex-1" />

			<div className="flex shrink-0 items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					className={btnCls}
					onClick={toggleTheme}
					aria-label={isDark ? "主题，切换亮色" : "主题，切换暗色"}
					title={isDark ? "切换亮色" : "切换暗色"}
				>
					{isDark ? <SunIcon className={iconCls} /> : <MoonIcon className={iconCls} />}
					<span className="hidden text-sm sm:inline">主题</span>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className={btnCls}
					onClick={openSettingsModal}
					title="设置"
					aria-label="设置"
				>
					<Cog6ToothIcon className={iconCls} />
					<span className="hidden text-sm sm:inline">设置</span>
				</Button>
			</div>
		</header>
	);
}
