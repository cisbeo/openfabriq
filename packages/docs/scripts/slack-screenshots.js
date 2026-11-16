// The example Slack threads of the Slack page, drawn in slack-threads.html (a fictional person and
// repository, from real exchanges). The sandbox reads files from ~/.dev-browser/tmp only:
//
//   cp packages/docs/scripts/slack-threads.html ~/.dev-browser/tmp/
//   dev-browser --headless run packages/docs/scripts/slack-screenshots.js
//   cp ~/.dev-browser/tmp/slack-request.png packages/docs/public/screenshots/slack/thread-request.png
//   cp ~/.dev-browser/tmp/slack-conversation.png packages/docs/public/screenshots/slack/thread-conversation.png
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setViewportSize({ width: 820, height: 1200 });
await page.setContent(await readFile("slack-threads.html"));
await page.waitForTimeout(500);
for (const id of ["request", "conversation"])
	await saveScreenshot(
		await page.locator(`#${id}`).screenshot(),
		`slack-${id}.png`,
	);
console.log("done");
