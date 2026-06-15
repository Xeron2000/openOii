import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { getWorkbenchStatusMeta } from "~/features/comic-workflow/state/deriveWorkbenchStatus";
import { StagePipeline } from "./StagePipeline";

function renderStagePipeline(props: Partial<Parameters<typeof StagePipeline>[0]> = {}) {
	return render(
		<StagePipeline
			currentStage="plan"
			isGenerating={false}
			workbenchStatus={getWorkbenchStatusMeta("idle")}
			awaitingConfirm={false}
			hasRecovery={false}
			onResume={vi.fn()}
			onCancel={vi.fn()}
			{...props}
		/>,
	);
}

describe("StagePipeline", () => {
	it("does not duplicate the sidebar chat entry while idle", () => {
		renderStagePipeline({ onToggleChat: vi.fn() });

		expect(
			screen.queryByRole("button", { name: "打开对话面板" }),
		).not.toBeInTheDocument();
	});

	it("opens the chat drawer from the confirmation action", async () => {
		const user = userEvent.setup();
		const onToggleChat = vi.fn();

		renderStagePipeline({ awaitingConfirm: true, onToggleChat });

		await user.click(screen.getByRole("button", { name: "打开对话面板" }));

		expect(onToggleChat).toHaveBeenCalledTimes(1);
	});

	it("omits the chat action when no handler is provided", () => {
		renderStagePipeline();

		expect(
			screen.queryByRole("button", { name: "打开对话面板" }),
		).not.toBeInTheDocument();
	});

	it("announces the current workbench status", () => {
		renderStagePipeline({
			workbenchStatus: getWorkbenchStatusMeta("awaitingConfirm"),
		});

		expect(screen.getByText("工作台状态：待确认")).toBeInTheDocument();
		expect(screen.getByTitle("正在等待创作者确认后继续")).toHaveTextContent(
			"待确认",
		);
	});
});
