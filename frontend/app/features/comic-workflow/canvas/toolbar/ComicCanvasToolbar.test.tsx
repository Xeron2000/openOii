import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { exportApi } from "~/services/api";
import { ComicCanvasToolbar } from "./ComicCanvasToolbar";

const editorMock = {
	getCurrentToolId: vi.fn(() => "select"),
	getZoomLevel: vi.fn(() => 1),
	getViewportScreenCenter: vi.fn(() => ({ x: 0, y: 0 })),
	setCurrentTool: vi.fn(),
	zoomIn: vi.fn(),
	zoomOut: vi.fn(),
	resetZoom: vi.fn(),
	zoomToFit: vi.fn(),
};

vi.mock("tldraw", () => ({
	track: (component: unknown) => component,
	useEditor: () => editorMock,
}));

vi.mock("~/services/api", () => ({
	exportApi: {
		triggerWebtoon: vi.fn(),
		getStatus: vi.fn(),
	},
	getStaticUrl: (path: string) => path,
}));

vi.mock("~/utils/toast", () => ({
	toast: {
		info: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
	},
}));

function renderToolbar(overrides = {}) {
	return render(
		<ComicCanvasToolbar
			projectId={15}
			onResetLayout={vi.fn()}
			{...overrides}
		/>,
	);
}

describe("ComicCanvasToolbar", () => {
	it("does not render the removed consistency evaluation button", () => {
		renderToolbar();

		expect(screen.queryByLabelText("一致性评估")).not.toBeInTheDocument();
	});

	it("does not render shot sorting controls", () => {
		renderToolbar();

		expect(screen.queryByLabelText("重排镜头顺序")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("保存镜头顺序")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("撤销镜头重排")).not.toBeInTheDocument();
	});

	it("exports Webtoon directly without showing a PDF option", async () => {
		const user = userEvent.setup();
		vi.mocked(exportApi.triggerWebtoon).mockResolvedValue({
			export_id: "export-1",
			project_id: 15,
			format: "webtoon",
			status: "processing",
			download_url: null,
			created_at: "",
		});
		vi.mocked(exportApi.getStatus).mockResolvedValue({
			export_id: "export-1",
			project_id: 15,
			format: "webtoon",
			status: "completed",
			download_url: "/static/exports/story_webtoon.png",
			created_at: "",
		});
		renderToolbar();

		await user.click(screen.getByLabelText("导出 Webtoon 长图"));

		expect(screen.queryByRole("button", { name: "PDF 漫画册" })).not.toBeInTheDocument();
		expect(exportApi.triggerWebtoon).toHaveBeenCalledWith(15);
	});
});
