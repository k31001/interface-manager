import { NextResponse } from "next/server";

export function jsonOk(data: unknown) {
  return NextResponse.json(data);
}

export function jsonErr(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status });
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    return jsonOk(await fn());
  } catch (err) {
    console.error(err);
    return jsonErr(err);
  }
}

/**
 * Stream newline-delimited JSON progress events while `run` works, then a final
 * `{type:"done", payload}` (or `{type:"error"}`). Lets the client render a real
 * progress bar with loading stages instead of a blank spinner.
 */
export function ndjsonStream(run: (emit: (o: unknown) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (o: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* controller already closed */
        }
      };
      try {
        const payload = await run(emit);
        emit({ type: "done", payload });
      } catch (err) {
        console.error(err);
        emit({ type: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
