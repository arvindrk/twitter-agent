export function initLogger(): void {
	const ts = () =>
		new Date().toLocaleString("en-US", {
			timeZone: "America/Los_Angeles",
			hour12: true,
		});
	const origLog = console.log.bind(console);
	const origWarn = console.warn.bind(console);
	const origError = console.error.bind(console);
	console.log = (...args) => origLog(ts(), ...args);
	console.warn = (...args) => origWarn(ts(), ...args);
	console.error = (...args) => origError(ts(), ...args);
}
