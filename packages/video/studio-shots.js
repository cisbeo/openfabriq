// The studio scene's screens, at twice the pixels: the landing's demo of the studio, from the
// docs' made-up week (packages/studio/scripts/docs-seed.ts). Run the docs' site first, then:
//
//   pnpm docs:dev                                   (from the repository's root)
//   dev-browser --headless run packages/video/studio-shots.js
//   for s in board run wiki chat; do cp ~/.dev-browser/tmp/studio-$s.png packages/video/assets/images/; done
//   dev-browser stop
const base = "http://localhost:4320/studio-demo/index.html#/";
const p = "project=acme%2Fweb-app";
const page = await browser.newPage();
await page.emulateMedia({ colorScheme: "light" });
await page.setViewportSize({ width: 1440, height: 900 });
const cdp = await page.context().newCDPSession(page);
// Twice the pixels: Chrome draws the page again at that scale, so the words stay sharp.
const shoot = async (name) => {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "png",
		clip: { x: 0, y: 0, width: 1440, height: 900, scale: 2 },
	});
	await saveScreenshot(Buffer.from(data, "base64"), `studio-${name}.png`);
	console.log(`ok ${name}`);
};
const shots = {
	board: `board?${p}`,
	run: `run/implement-44?${p}`,
	wiki: `wiki?${p}&page=how-it-fits-together.md`,
};
for (const [name, hash] of Object.entries(shots)) {
	await page.goto("about:blank");
	await page.goto(base + hash);
	await page.waitForSelector("h1");
	if (name === "wiki") await page.waitForSelector(".wiki-diagram svg");
	await page.waitForTimeout(1500);
	await shoot(name);
}
// The chat answers from its recorded reply.
await page.goto("about:blank");
await page.goto(`${base}chat?${p}`);
const box = page.getByRole("textbox").first();
await box.waitFor();
await box.fill("What failed this week, and what should I do about it?");
await box.press("Enter");
await page.getByText("relabel #49").waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
await shoot("chat");
await cdp.detach();
