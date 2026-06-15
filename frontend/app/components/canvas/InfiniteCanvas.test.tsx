import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InfiniteCanvas } from "./InfiniteCanvas";

vi.mock("~/features/comic-workflow/canvas/ComicWorkflowCanvas", () => ({
	ComicWorkflowCanvas: ({ projectId }: { projectId: number }) => (
		<div data-testid="comic-workflow-canvas">project:{projectId}</div>
	),
}));

describe("InfiniteCanvas", () => {
	it("renders the comic workflow canvas", () => {
		render(<InfiniteCanvas projectId={15} />);

		expect(screen.getByTestId("comic-workflow-canvas")).toHaveTextContent(
			"project:15",
		);
	});
});
