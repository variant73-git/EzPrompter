/**
 * SSE writer over a Web ReadableStream.
 *
 *   const { stream, send, close } = createSseStream();
 *   return new Response(stream, { headers: SSE_HEADERS });
 *   ...
 *   send('assistant_token', { delta: 'hi' });
 *   close();
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function createSseStream() {
  let controllerRef;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controllerRef = controller; },
    cancel() { /* client disconnected */ },
  });

  function send(event, dataObj) {
    if (!controllerRef) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(dataObj)}\n\n`;
    try { controllerRef.enqueue(encoder.encode(payload)); } catch (_) {}
  }

  function close() {
    if (controllerRef) {
      try { controllerRef.close(); } catch (_) {}
      controllerRef = null;
    }
  }

  return { stream, send, close };
}
