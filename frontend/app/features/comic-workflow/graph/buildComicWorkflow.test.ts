import { describe, expect, it } from "vitest";
import type { Character, Project, Shot } from "~/types";
import { buildComicWorkflow, getOutputState, sortShots } from "./buildComicWorkflow";

const providerSettings = {
	text: {
		selected_key: "default",
		source: "default",
		resolved_key: null,
		valid: true,
		reason_code: null,
		reason_message: null,
	},
	image: {
		selected_key: "default",
		source: "default",
		resolved_key: null,
		valid: true,
		reason_code: null,
		reason_message: null,
	},
	video: {
		selected_key: "default",
		source: "default",
		resolved_key: null,
		valid: true,
		reason_code: null,
		reason_message: null,
	},
} satisfies Project["provider_settings"];

function project(overrides: Partial<Project> = {}): Project {
	return {
		id: 15,
		title: "测试项目",
		story: "故事",
		style: "赛博",
		summary: "摘要",
		video_url: null,
		status: "draft",
		target_shot_count: 2,
		character_hints: [],
		creation_mode: "manual",
		reference_images: [],
		exports: [],
		created_at: "2026-06-14T00:00:00Z",
		updated_at: "2026-06-14T00:00:00Z",
		provider_settings: providerSettings,
		...overrides,
	};
}

function character(overrides: Partial<Character> = {}): Character {
	return {
		id: 1,
		project_id: 15,
		name: "阿一",
		description: "主角",
		image_url: "/static/a.png",
		reference_images: [],
		has_embedding: true,
		visual_notes: null,
		approval_state: "draft",
		approval_version: 1,
		approved_at: null,
		approved_name: null,
		approved_description: null,
		approved_image_url: null,
		...overrides,
	};
}

function shot(overrides: Partial<Shot> = {}): Shot {
	return {
		id: 10,
		project_id: 15,
		order: 1,
		description: "镜头",
		prompt: null,
		image_prompt: null,
		image_url: "/static/s.png",
		video_url: null,
		duration: 4,
		camera: "wide",
		motion_note: null,
		scene: "屋顶",
		action: null,
		expression: null,
		lighting: null,
		dialogue: null,
		sfx: null,
		seed: null,
		character_ids: [1],
		approval_state: "draft",
		approval_version: 1,
		approved_at: null,
		approved_description: null,
		approved_prompt: null,
		approved_image_prompt: null,
		approved_duration: null,
		approved_camera: null,
		approved_motion_note: null,
		approved_scene: null,
		approved_action: null,
		approved_expression: null,
		approved_lighting: null,
		approved_dialogue: null,
		approved_sfx: null,
		approved_character_ids: [],
		...overrides,
	};
}

describe("buildComicWorkflow", () => {
	it("builds the four fixed sections and only materialized content nodes", () => {
		const graph = buildComicWorkflow({
			project: project(),
			characters: [character()],
			shots: [shot()],
			blockingClips: [],
			isGenerating: false,
		});

		expect(graph.sections.map((section) => section.section)).toEqual([
			"brief",
			"elements",
			"shotline",
			"output",
		]);
		expect(graph.nodes.map((node) => node.kind)).toEqual([
			"brief",
			"character",
			"shot",
		]);
		expect(graph.orderedShotIds).toEqual([10]);
	});

	it("omits cards for empty content", () => {
		const graph = buildComicWorkflow({
			project: project({ title: "未命名项目", story: null, summary: null }),
			characters: [
				character({
					name: "",
					description: null,
					image_url: null,
					reference_images: [],
					has_embedding: false,
				}),
			],
			shots: [
				shot({
					description: "",
					image_url: null,
					duration: null,
					camera: null,
					scene: null,
					character_ids: [],
				}),
			],
			blockingClips: [],
			isGenerating: false,
		});

		expect(graph.sections.map((section) => section.section)).toEqual([
			"brief",
			"elements",
			"shotline",
			"output",
		]);
		expect(graph.sections.map((section) => section.countLabel)).toEqual([
			"0 brief",
			"0 elements",
			"0 shots",
			"0 final",
		]);
		expect(graph.nodes).toEqual([]);
		expect(graph.orderedShotIds).toEqual([]);
	});

	it("renders output only when final content exists", () => {
		const graph = buildComicWorkflow({
			project: project({ video_url: "/static/final.mp4", status: "ready" }),
			characters: [],
			shots: [],
			blockingClips: [],
			isGenerating: false,
		});

		expect(graph.nodes.map((node) => node.kind)).toEqual(["brief", "output"]);
	});

	it("creates automatic dependency, reference and sequence edges", () => {
		const graph = buildComicWorkflow({
			project: project({ video_url: "/static/final.mp4", status: "ready" }),
			characters: [character()],
			shots: [shot(), shot({ id: 11, order: 2 })],
			blockingClips: [],
			isGenerating: false,
		});

		expect(graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "brief", to: "character:1" }),
				expect.objectContaining({ from: "character:1", to: "shot:10" }),
				expect.objectContaining({ from: "shot:10", to: "shot:11" }),
				expect.objectContaining({ from: "shot:11", to: "output" }),
			]),
		);
	});

	it("marks output as needing recomposition when old video is superseded", () => {
		expect(
			getOutputState({
				project: project({ video_url: "/static/final.mp4", status: "superseded" }),
				blockingClips: [],
			}),
		).toBe("needs_recompose");
	});

	it("sorts shots by order then id", () => {
		expect(
			sortShots([
				shot({ id: 12, order: 2 }),
				shot({ id: 11, order: 1 }),
				shot({ id: 10, order: 1 }),
			]).map((item) => item.id),
		).toEqual([10, 11, 12]);
	});
});
