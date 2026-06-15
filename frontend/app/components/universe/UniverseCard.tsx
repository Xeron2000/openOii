import { Link } from "react-router-dom";
import { Card } from "~/components/ui/Card";
import type { Universe } from "~/types";
import { SparklesIcon, UsersIcon } from "@heroicons/react/24/outline";

interface UniverseCardProps {
	universe: Universe;
}

export function UniverseCard({ universe }: UniverseCardProps) {
	return (
		<Link to={`/universes/${universe.id}`} className="block group">
			<Card className="hover:shadow-brutal transition-all duration-200 group-hover:-translate-y-0.5 h-full">
				{/* Cover */}
				{universe.cover_image_url && (
					<div className="mb-3 -mt-2 -mx-2 rounded-lg overflow-hidden h-32">
						<img
							src={universe.cover_image_url}
							alt={universe.name}
							className="w-full h-full object-cover"
						/>
					</div>
				)}

				{/* Name */}
				<h2 className="text-lg font-heading font-bold underline-sketch mb-1">
					{universe.name}
				</h2>

				{/* Description */}
				{universe.description && (
					<p className="text-sm text-base-content/75 line-clamp-2 mb-3">
						{universe.description}
					</p>
				)}

				{/* Stats */}
				<div className="flex items-center gap-4 text-xs text-base-content/70">
					<span className="inline-flex items-center gap-1">
						<SparklesIcon className="w-3.5 h-3.5" />
						{universe.projects_count} 章节
					</span>
					<span className="inline-flex items-center gap-1">
						<UsersIcon className="w-3.5 h-3.5" />
						{universe.shared_characters_count} 角色
					</span>
				</div>
			</Card>
		</Link>
	);
}
