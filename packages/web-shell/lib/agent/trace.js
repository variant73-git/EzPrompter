/**
 * Langfuse tracing — opt-in observability layer.
 *
 * Activated by setting LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY + (optional)
 * LANGFUSE_HOST in the environment. Without those, every export is a no-op
 * — dev sessions stay frictionless and there's zero risk of leaking traces
 * when running locally.
 *
 * Why Langfuse: open source (MIT), self-hostable on any cloud, no
 * per-trace pricing when you run it yourself. Provides a trace tree UI
 * showing every iteration + tool call + LLM response, latency + cost
 * dashboards, and prompt versioning. Same SaaS shape as LangSmith but $0
 * after the one-time deploy.
 *
 * Shape we emit:
 *   - 1 Trace per agent run (root span)
 *     - 1 Generation per LLM call (model, input messages, output, tokens)
 *     - 1 Span per tool call (tool name, args, result, duration)
 *
 * Fails OPEN: any export error logs to stderr once and continues. We
 * cannot let observability take down the chat.
 */
import { Langfuse } from 'langfuse';

let client = null;
let initialized = false;
let warned = false;

function warnOnce(reason) {
  if (warned) return;
  // eslint-disable-next-line no-console
  console.warn(`[langfuse] ${reason} — tracing disabled`);
  warned = true;
}

function getClient() {
  if (initialized) return client;
  initialized = true;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    warnOnce('LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set');
    return null;
  }
  try {
    client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
      flushAt: 5,
      flushInterval: 2000,
    });
    return client;
  } catch (e) {
    warnOnce(`init failed: ${e?.message || e}`);
    return null;
  }
}

/**
 * Open a Trace for the start of an agent run. Returns a trace handle the
 * driver passes to startGeneration / startSpan / endTrace. Returns null
 * when Langfuse isn't configured — caller code should null-check.
 */
export function startAgentTrace({ runId, userId, model, sessionId, threadId, input }) {
  const c = getClient();
  if (!c) return null;
  try {
    const trace = c.trace({
      id: runId,
      name: 'agent.run',
      userId: userId != null ? String(userId) : undefined,
      sessionId: sessionId || threadId || undefined,
      input,
      metadata: { model, threadId },
    });
    return trace;
  } catch (e) {
    warnOnce(`trace failed: ${e?.message || e}`);
    return null;
  }
}

export function logGeneration(trace, { name, model, input, output, usage, durationMs }) {
  if (!trace) return null;
  try {
    return trace.generation({
      name: name || 'llm.call',
      model,
      input,
      output,
      usage: usage ? {
        input: usage.input_tokens,
        output: usage.output_tokens,
        unit: 'TOKENS',
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      } : undefined,
      endTime: durationMs ? new Date(Date.now()) : undefined,
    });
  } catch (e) {
    warnOnce(`generation failed: ${e?.message || e}`);
    return null;
  }
}

export function logToolSpan(trace, { name, input, output, durationMs, error }) {
  if (!trace) return null;
  try {
    return trace.span({
      name: `tool.${name}`,
      input,
      output,
      level: error ? 'ERROR' : 'DEFAULT',
      statusMessage: error || undefined,
      endTime: durationMs ? new Date(Date.now()) : undefined,
    });
  } catch (e) {
    warnOnce(`span failed: ${e?.message || e}`);
    return null;
  }
}

export function endAgentTrace(trace, { output, status, totalCostCents, iterations }) {
  if (!trace) return;
  try {
    trace.update({
      output,
      metadata: { status, iterations, costCents: totalCostCents },
    });
  } catch (e) {
    warnOnce(`endTrace failed: ${e?.message || e}`);
  }
}

/**
 * Flush pending events. Call from process exit / serverless function end
 * so the final batch isn't lost when the worker tears down.
 */
export async function flushLangfuse() {
  const c = getClient();
  if (!c) return;
  try { await c.flushAsync(); } catch (e) { warnOnce(`flush failed: ${e?.message || e}`); }
}
