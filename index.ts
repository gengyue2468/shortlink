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

async function shutdown() {
	await server.stop();
	await flushAnalytics();
	process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
