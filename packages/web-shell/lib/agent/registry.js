/**
 * Tool registry. A tool is:
 *   {
 *     name: string                      // LLM-visible identifier
 *     description: string               // shown to LLM in tool spec
 *     classification: 'safe'|'destructive'|'needs_choice'
 *     inputSchema: JSON Schema          // Anthropic + OpenAI + Gemini all accept this
 *     execute: async (args, ctx) => { ... }   // server-side runner
 *   }
 *
 * The driver instantiates one Registry per board+user request and registers
 * the tools from the canonical exports in lib/agent/tools/index.js.
 */
const VALID_CLASS = new Set(['safe', 'destructive', 'needs_choice']);

export class Registry {
  constructor() {
    this._tools = new Map();
  }

  register(tool) {
    if (!tool?.name) throw new Error('tool.name required');
    if (this._tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    if (!VALID_CLASS.has(tool.classification)) {
      throw new Error(`invalid classification: ${tool.classification}`);
    }
    if (typeof tool.execute !== 'function') throw new Error('tool.execute required');
    this._tools.set(tool.name, tool);
  }

  get(name) { return this._tools.get(name); }
  all() { return Array.from(this._tools.values()); }

  /**
   * Emit the Anthropic tool spec list (POST /v1/messages tools field).
   * `allowlist` (optional array of names) filters which tools are exposed
   * to the LLM for this run — used by Smart Edit chat to scope down.
   */
  toAnthropicSpec(allowlist = null) {
    return this.all()
      .filter((t) => !allowlist || allowlist.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description || '',
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      }));
  }

  /**
   * Emit the OpenAI chat.completions tools[] spec.
   *   [{type:'function', function:{name, description, parameters}}, ...]
   */
  toOpenAISpec(allowlist = null) {
    return this.all()
      .filter((t) => !allowlist || allowlist.includes(t.name))
      .map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      }));
  }

  /**
   * Emit the Gemini generateContent tools[] spec. Gemini wraps all function
   * declarations into a single tool object — the array always has length 1
   * with all the functionDeclarations inside it (even when empty).
   */
  toGeminiSpec(allowlist = null) {
    const declarations = this.all()
      .filter((t) => !allowlist || allowlist.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || { type: 'object', properties: {} },
      }));
    return [{ functionDeclarations: declarations }];
  }
}
