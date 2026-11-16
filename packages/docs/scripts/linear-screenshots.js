// The example Linear issues of the Linear page, drawn in linear-issues.html (a fictional person,
// team and repository, from real sessions). The sandbox reads files from ~/.dev-browser/tmp only:
//
//   cp packages/docs/scripts/linear-issues.html ~/.dev-browser/tmp/
//   dev-browser --headless run packages/docs/scripts/linear-screenshots.js
//   for c in assign unclear mention; do cp ~/.dev-browser/tmp/linear-$c.png packages/docs/public/screenshots/linear/issue-$c.png; done
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setViewportSize({ width: 760, height: 1600 });
await page.setContent(await readFile("linear-issues.html"));
await page.waitForTimeout(500);
for (const id of ["assign", "unclear", "mention"])
	await saveScreenshot(
		await page.locator(`#${id}`).screenshot(),
		`linear-${id}.png`,
	);
console.log("done");
