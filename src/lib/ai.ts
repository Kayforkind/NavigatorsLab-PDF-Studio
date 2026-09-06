export interface AISettings {
  model: string;
  onProgress?: (stage: string, progress: number) => void;
}

export const AI_MODELS = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1', label: 'Qwen2.5 0.5B · fast (~0.6 GB download)', min: '~1.6 GB' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B · better (~0.9 GB download)', min: '~2.5 GB' },
];

// type-only import keeps web-llm out of the main bundle
export type Engine = import('@mlc-ai/web-llm').MLCEngineInterface;

let enginePromise: Promise<Engine> | null = null;
let engineModel = '';
let progressText = '';

export function lastProgressText(): string {
  return progressText;
}

export async function loadEngine(model: string, onProgress?: (text: string) => void): Promise<Engine> {
  if (enginePromise && engineModel === model) return enginePromise;
  const p = (p: { text: string; progress?: number }) => {
    progressText = p.text;
    onProgress?.(p.text);
  };
  engineModel = model;
  enginePromise = (async () => {
    try {
      const webllm = await import('@mlc-ai/web-llm');
      return await webllm.CreateMLCEngine(model, { initProgressCallback: p });
    } catch (err) {
      enginePromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      const friendly =
        /fetch|network|load failed|offline/i.test(msg)
          ? 'Could not download the model — this needs a network connection the first time. The model is cached on your device afterwards; your document itself never leaves this machine.'
          : msg;
      throw new Error(friendly);
    }
  })();
  return enginePromise;
}

/** Unloads the model to free memory (keeps nothing user-related). */
export function disposeEngine(): void {
  enginePromise = null;
  engineModel = '';
}

export async function chat(
  engine: Engine,
  opts: { system: string; user: string },
): Promise<string> {
  const res = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    temperature: 0.2,
    max_tokens: 600,
  });
  const text = res.choices?.[0]?.message?.content;
  return (text ?? '').trim();
}
