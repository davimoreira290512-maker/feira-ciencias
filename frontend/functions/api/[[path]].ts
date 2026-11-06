interface Env {
  API_ORIGIN: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.API_ORIGIN) {
    return new Response("API_ORIGIN is not configured.", { status: 503 });
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(
    incomingUrl.pathname + incomingUrl.search,
    env.API_ORIGIN.replace(/\/$/, "") + "/",
  );

  return fetch(new Request(targetUrl, request));
};
