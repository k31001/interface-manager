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
