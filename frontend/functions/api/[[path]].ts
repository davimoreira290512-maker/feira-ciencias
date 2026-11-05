interface Env { BACKEND_URL: string }
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const base = env.BACKEND_URL?.replace(/\/$/, "");
  if (!base) return new Response("BACKEND_URL não configurado.", { status: 503 });
  const incoming = new URL(request.url);
  const target = base + incoming.pathname + incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
};
