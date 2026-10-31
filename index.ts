import { app } from "./app";
import { flushAnalytics } from "./analytics";
import { PORT } from "./config";

const server = Bun.serve({
	port: PORT,
	fetch(request, server) {
		return app.fetch(request, { remoteAddress: server.requestIP(request)?.address });
	},
});

console.log(`Running on ${Bun.env.BASE_URL ?? server.url}`);

let stopping = false;
async function shutdown() {
	if (stopping) return;
	stopping = true;
	// Bound graceful shutdown even with a stalled client or analytics request.
	setTimeout(() => { void server.stop(true); process.exit(0); }, 5000).unref();
	try {
		await server.stop();
		await flushAnalytics();
		process.exit(0);
	} catch (error) {
		console.error("Shutdown failed:", error);
		process.exit(1);
	}
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
