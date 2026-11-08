/** Next.js server startup hook: starts the SOC alert watcher in the Node.js runtime. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWatchLoop } = await import("@/lib/ai/watchLoop");
    startWatchLoop();
  }
}
