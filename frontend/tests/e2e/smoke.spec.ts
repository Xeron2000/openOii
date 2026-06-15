import { expect, test } from "@playwright/test";

test("homepage exposes the story bootstrap flow", async ({ page }) => {
	await page.goto("/");

	await expect(page).toHaveTitle(/openOii/);
	await expect(page.getByRole("heading", { name: "openOii" })).toBeVisible();
	await expect(page.getByText("用 AI 将故事转化为漫剧视频")).toBeVisible();

	const storyInput = page.getByPlaceholder("写下你的故事创意…");
	const startButton = page.getByRole("button", { name: "开始生成故事" });

	await expect(storyInput).toBeVisible();
	await expect(startButton).toBeDisabled();

	await storyInput.fill("一个灯塔管理员发现会发光的地图。");
	await expect(startButton).toBeEnabled();
	await expect(page.getByRole("button", { name: "精细审阅" })).toBeVisible();
	await expect(page.getByRole("button", { name: "快速生成" })).toBeVisible();
});
