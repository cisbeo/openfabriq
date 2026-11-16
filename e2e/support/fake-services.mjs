// Loaded into the CLI's process by the e2e tests (node --import): the addresses of Slack's Web API
// and Linear's API are fixed in the code, so their calls go to E2E_FAKE_API, a server of the test.
// Sentry needs nothing: its address is asked, and the test types the fake one.
const fake = process.env.E2E_FAKE_API;
const SERVICES = {
	"https://slack.com/api/": "/slack/",
	"https://api.linear.app/": "/linear/",
};

if (fake) {
	const real = globalThis.fetch;
	globalThis.fetch = (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		for (const [from, to] of Object.entries(SERVICES))
			if (url.startsWith(from))
				return real(`${fake}${to}${url.slice(from.length)}`, init);
		return real(input, init);
	};
}
