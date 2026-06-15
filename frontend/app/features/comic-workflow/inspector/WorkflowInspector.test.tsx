import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { describe, expect, it } from "vitest";
import type { Character } from "~/types";
import type { ComicWorkflowNode } from "../graph/types";
import { WorkflowInspector } from "./WorkflowInspector";

function renderWithClient(ui: React.ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function character(): Character {
	return {
		id: 1,
		project_id: 15,
		name: "阿一",
		description: "主角",
		image_url: null,
		reference_images: [],
		has_embedding: false,
		visual_notes: null,
		approval_state: "draft",
		approval_version: 1,
		approved_at: null,
		approved_name: null,
		approved_description: null,
		approved_image_url: null,
	};
}

function characterNode(): ComicWorkflowNode {
	const entity = character();
	return {
		id: "character:1",
		kind: "character",
		section: "elements",
		title: "阿一",
		subtitle: "角色设定",
		status: "review",
		entityId: 1,
		character: entity,
		imageUrl: null,
	};
}

describe("WorkflowInspector", () => {
	it("shows an empty state when nothing is selected", () => {
		render(
			<WorkflowInspector
				projectId={15}
				selectedNode={null}
				structureLocked={false}
			/>,
		);

		expect(screen.getByText("选择一个画布卡片查看细节")).toBeInTheDocument();
	});

	it("locks write actions while generation is active", async () => {
		const user = userEvent.setup();
		renderWithClient(
			<WorkflowInspector
				projectId={15}
				selectedNode={characterNode()}
				structureLocked
			/>,
		);

		await user.click(screen.getByRole("button", { name: "操作" }));

		expect(screen.getByText("生成运行中，结构写入操作已锁定。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /批准/ })).toBeDisabled();
	});
});
