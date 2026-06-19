// @ts-expect-error - Bun file import resolves to a path inside the standalone binary
import notFoundImage from "./404.webp" with { type: "file" };

let cachedDataUri: string | null = null;

async function loadDataUri(): Promise<string> {
  if (cachedDataUri !== null) {
    return cachedDataUri;
  }

  const bytes = await Bun.file(notFoundImage).arrayBuffer();
  cachedDataUri = `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
  return cachedDataUri;
}

function renderHtml(imageDataUri: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>404 - Page Not Found</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background-color: #f2eddb;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #2a2a2a;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .wrap {
        text-align: center;
        max-width: min(1100px, 100%);
      }
      .frame {
        display: inline-block;
        line-height: 0;
        padding: 28px;
        background-color: #f2eddb;
      }
      .frame .inset {
        display: block;
        line-height: 0;
        padding: 50px;
        background-color: #f2eddb;
        border-radius: 18px;
      }
      .frame img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 18px;
        mix-blend-mode: multiply;
      }
      h1 {
        margin: 24px 0 8px;
        font-size: clamp(20px, 2.4vw, 28px);
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      p {
        margin: 0 auto;
        max-width: 520px;
        font-size: clamp(14px, 1.4vw, 16px);
        line-height: 1.55;
        color: #4a4a4a;
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <div class="frame">
        <div class="inset">
          <img src="${imageDataUri}" alt="404 - Page not found" width="2816" height="1536" />
        </div>
      </div>
      <h1>This page isn't being shared anymore</h1>
      <p>The tunnel for this subdomain is offline. If this is your URL, restart the w-share client to bring it back online.</p>
    </main>
  </body>
</html>
`;
}

export async function notFoundResponse(): Promise<Response> {
  return new Response(renderHtml(await loadDataUri()), {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
