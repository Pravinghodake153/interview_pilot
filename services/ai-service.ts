// ──────────────────────────────────────────────
// AlgoPilot — DeepSeek AI Service
// ──────────────────────────────────────────────
// Handles all communication with DeepSeek V4 Flash API.
// Provides interviewer persona, problem presentation,
// follow-up questions, and report generation.
// Supports both streaming (SSE) and non-streaming modes.



import { prisma } from "@/lib/prisma";

export interface ChatMessage {
  role: "system" | "assistant" | "user";
  content: string;
}

// ─── Shared config helper ────────────────────

export async function getProviderConfig() {
  // Default fallbacks from environment
  let activeProvider = "openrouter";
  let activeModel = "openrouter/free";
  let reportProvider = "openrouter";
  let reportModel = "openrouter/free";
  let geminiKey = process.env.GEMINI_API_KEY || "";
  let zaiKey = process.env.ZAI_API_KEY || "511ba8c060534cd2b50e8e78170d4ed2.6hEKr2c10VeIHk3c";
  let openrouterKey = process.env.OPENROUTER_API_KEY || "";
  let deepseekKey = process.env.DEEPSEEK_API_KEY || "";

  try {
    const providerSetting = await prisma.systemSetting.findUnique({ where: { key: "DEFAULT_AI_PROVIDER" } });
    if (providerSetting) activeProvider = providerSetting.value;

    const modelSetting = await prisma.systemSetting.findUnique({ where: { key: "DEFAULT_AI_MODEL" } });
    if (modelSetting) activeModel = modelSetting.value;
    
    const reportProviderSetting = await prisma.systemSetting.findUnique({ where: { key: "REPORT_AI_PROVIDER" } });
    if (reportProviderSetting) reportProvider = reportProviderSetting.value;
    else reportProvider = activeProvider;

    const reportModelSetting = await prisma.systemSetting.findUnique({ where: { key: "REPORT_AI_MODEL" } });
    if (reportModelSetting) reportModel = reportModelSetting.value;
    else reportModel = activeModel;

    const geminiKeySetting = await prisma.systemSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });
    if (geminiKeySetting && geminiKeySetting.value) geminiKey = geminiKeySetting.value;

    const zaiKeySetting = await prisma.systemSetting.findUnique({ where: { key: "ZAI_API_KEY" } });
    if (zaiKeySetting && zaiKeySetting.value) zaiKey = zaiKeySetting.value;

    const openrouterKeySetting = await prisma.systemSetting.findUnique({ where: { key: "OPENROUTER_API_KEY" } });
    if (openrouterKeySetting && openrouterKeySetting.value) openrouterKey = openrouterKeySetting.value;

    const deepseekKeySetting = await prisma.systemSetting.findUnique({ where: { key: "DEEPSEEK_API_KEY" } });
    if (deepseekKeySetting && deepseekKeySetting.value) deepseekKey = deepseekKeySetting.value;
  } catch (e) {
    console.warn("Failed to fetch SystemSetting from Prisma, using defaults", e);
  }

  return {
    activeProvider,
    activeModel,
    reportProvider,
    reportModel,
    gemini: {
      key: geminiKey,
      url: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    openrouter: {
      key: openrouterKey,
      url: process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1",
    },
    deepseek: {
      key: deepseekKey,
      url: process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1",
    },
    zai: {
      key: zaiKey,
      url: process.env.ZAI_API_URL || "https://open.bigmodel.cn/api/paas/v4",
      model: process.env.ZAI_MODEL || "glm-4.7-flash",
    },
    ollama: {
      url: process.env.OLLAMA_API_URL || "http://localhost:11434/v1",
      model: process.env.OLLAMA_MODEL || "llama3",
    },
  };
}

/**
 * Send a non-streaming chat completion request.
 * Used for report generation and other cases where full response is needed at once.
 */
export async function deepseekChat(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    useReportModel?: boolean;
  }
): Promise<string> {
  const config = await getProviderConfig();

  async function makeRequest(
    url: string,
    key: string,
    model: string,
    isOpenRouter: boolean,
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
    timeoutMs: number = 30000
  ) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(isOpenRouter ? {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "AlgoPilot",
          } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 1024,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // Determine active provider settings
  const activeProviderToUse = options?.useReportModel ? config.reportProvider : config.activeProvider;
  
  let url = config.gemini.url;
  let key = config.gemini.key;
  const model = options?.useReportModel ? config.reportModel : config.activeModel;
  let isOpenRouter = false;

  if (activeProviderToUse === "openrouter") {
    url = config.openrouter.url;
    key = config.openrouter.key;
    isOpenRouter = true;
  } else if (activeProviderToUse === "deepseek") {
    url = config.deepseek.url;
    key = config.deepseek.key;
  } else if (activeProviderToUse === "zai" || activeProviderToUse === "glm") {
    url = config.zai.url;
    key = config.zai.key;
  } else if (activeProviderToUse === "ollama") {
    url = config.ollama.url;
    key = "ollama";
  } else {
    // Default to Gemini
    url = config.gemini.url;
    key = config.gemini.key;
  }

  if (!key) {
    throw new Error(`No API key configured for provider: ${activeProviderToUse}`);
  }

  try {
    return await makeRequest(url, key, model, isOpenRouter, messages, options, 90000);
  } catch (err) {
    console.error(`${activeProviderToUse} failed. Attempting Z.AI fallback...`, err);
    if (activeProviderToUse !== "zai" && config.zai.key) {
      try {
        return await makeRequest(config.zai.url, config.zai.key, "glm-4.7-flash", false, messages, options, 90000);
      } catch (fallbackErr) {
        console.error("Z.AI fallback also failed:", fallbackErr);
      }
    }
    throw err;
  }
}

/**
 * Send a streaming chat completion request.
 * Returns a ReadableStream that yields SSE-formatted text chunks.
 * Also returns a promise that resolves to the full accumulated text (for DB persistence).
 *
 * Focused on OpenRouter as the primary provider.
 */
function cleanMessagesForOpenRouter(rawMessages: ChatMessage[]): ChatMessage[] {
  if (!rawMessages || rawMessages.length === 0) return [];

  const cleaned: ChatMessage[] = [];
  for (const m of rawMessages) {
    if (!m.content || !m.content.trim()) continue;

    if (cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1];
      if (prev.role === m.role) {
        prev.content = `${prev.content}\n\n${m.content}`;
        continue;
      }
    }
    cleaned.push({ role: m.role, content: m.content });
  }
  return cleaned;
}

export async function deepseekChatStream(
  rawMessages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    onComplete?: (result: { content: string; thinking: string | null }) => Promise<void> | void;
  }
): Promise<{ stream: ReadableStream<Uint8Array>; fullText: Promise<{ content: string; thinking: string | null }> }> {
  const config = await getProviderConfig();

  const messages = cleanMessagesForOpenRouter(rawMessages);

  // Build a global, cross-provider failover chain to guarantee 100% uptime
  const failoverChain: Array<{ model: string; provider: string; url: string; key: string }> = [];

  // Add primary configured provider
  let primaryUrl = config.gemini.url;
  let primaryKey = config.gemini.key;
  if (config.activeProvider === "openrouter") {
    primaryUrl = config.openrouter.url;
    primaryKey = config.openrouter.key;
  } else if (config.activeProvider === "deepseek") {
    primaryUrl = config.deepseek.url;
    primaryKey = config.deepseek.key;
  } else if (config.activeProvider === "zai" || config.activeProvider === "glm") {
    primaryUrl = config.zai.url;
    primaryKey = config.zai.key;
  } else if (config.activeProvider === "ollama") {
    primaryUrl = config.ollama.url;
    primaryKey = "ollama";
  }

  // Auto-lowercase model name if using GLM/Z.AI to prevent case-sensitive API rejections (e.g. GLM-4.7-Flash -> glm-4.7-flash)
  const isGLM = config.activeProvider === "zai" || config.activeProvider === "glm";
  const formattedModel = isGLM ? config.activeModel.toLowerCase() : config.activeModel;

  if (primaryKey) {
    failoverChain.push({
      model: formattedModel,
      provider: config.activeProvider,
      url: primaryUrl,
      key: primaryKey,
    });
  }

  // Add OpenRouter backups if available (prioritizing active free models)
  if (config.openrouter.key) {
    failoverChain.push(
      { model: "google/gemma-4-31b-it:free", provider: "openrouter", url: config.openrouter.url, key: config.openrouter.key },
      { model: "liquid/lfm-2.5-2.6b:free", provider: "openrouter", url: config.openrouter.url, key: config.openrouter.key },
      { model: "openrouter/free", provider: "openrouter", url: config.openrouter.url, key: config.openrouter.key },
      { model: "google/gemini-2.5-flash", provider: "openrouter", url: config.openrouter.url, key: config.openrouter.key },
      { model: "deepseek/deepseek-chat", provider: "openrouter", url: config.openrouter.url, key: config.openrouter.key }
    );
  }

  // Add direct Gemini API backup as high-reliability last resort
  if (config.gemini.key) {
    failoverChain.push({
      model: "gemini-2.5-flash",
      provider: "gemini",
      url: config.gemini.url,
      key: config.gemini.key,
    });
  }

  // Remove potential duplicates
  const uniqueChain = failoverChain.filter(
    (item, index, self) =>
      self.findIndex((t) => t.model === item.model && t.provider === item.provider) === index
  );

  let response: Response | null = null;
  let lastError: Error | null = null;

  for (const candidate of uniqueChain) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s connection timeout for ultra-fast provider failover
    const isOpenRouter = candidate.provider === "openrouter";

    try {
      console.log(`[AI-Service] Attempting chat stream with provider: ${candidate.provider}, model: ${candidate.model}`);
      const res = await fetch(`${candidate.url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${candidate.key}`,
          ...(isOpenRouter
            ? {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "AlgoPilot",
              }
            : {}),
        },
        body: JSON.stringify({
          model: candidate.model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2560,
          stream: true,
          ...(isOpenRouter && { include_reasoning: true }),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        response = res;
        console.log(`[AI-Service] Successfully connected to chat stream with model: ${candidate.model}`);
        break; // Successfully connected to stream!
      } else {
        const errText = await res.text();
        console.warn(`[AI-Service] Streaming API error (${res.status}) for provider ${candidate.provider}, model ${candidate.model}: ${errText}. Trying failover...`);
        lastError = new Error(`API error (${res.status}): ${errText}`);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.warn(`[AI-Service] Connection failed for provider ${candidate.provider}, model ${candidate.model}: ${err?.message || err}. Trying failover...`);
      lastError = err;
    }
  }

  if (!response || !response.ok) {
    throw lastError || new Error("All streaming failover providers failed");
  }

  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  // We'll accumulate the full text for DB persistence
  let fullTextResolve: (value: { content: string; thinking: string | null }) => void;
  const fullText = new Promise<{ content: string; thinking: string | null }>((resolve) => {
    fullTextResolve = resolve;
  });

  const encoder = new TextEncoder();
  let accumulated = ""; // Keeps tags for frontend UI rendering
  let accumulatedContent = ""; // Only raw output
  let accumulatedReasoning = ""; // Only raw reasoning
  let buffer = "";

  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.content || "";
    const reasoning =
      data.choices?.[0]?.message?.reasoning ||
      data.choices?.[0]?.message?.reasoning_content ||
      data.choices?.[0]?.delta?.reasoning ||
      data.choices?.[0]?.delta?.reasoning_content ||
      "";

    if (content || reasoning) {
      accumulatedContent = content;
      accumulatedReasoning = reasoning;
      accumulated = reasoning ? `\n*Thinking...*\n${reasoning}\n\n---\n\n${content}` : content;
    } else if (data.error) {
      throw new Error(`OpenRouter returned JSON error: ${data.error.message || JSON.stringify(data.error)}`);
    }
    
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (options?.onComplete) {
          await options.onComplete({ content: accumulatedContent, thinking: accumulatedReasoning || null });
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: accumulated })}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
        fullTextResolve({ content: accumulatedContent, thinking: accumulatedReasoning || null });
      }
    });
    return { stream, fullText };
  }

  const upstreamReader = response.body.getReader();
  const decoder = new TextDecoder();
  let isReasoning = false;
  let isCompleted = false;

  const handleFinish = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (isCompleted) return;
    isCompleted = true;
    
    // Smart Fallback: If model finished with ONLY reasoning tokens and no answer content
    if (!accumulatedContent.trim() && accumulatedReasoning.trim()) {
      const match = accumulatedReasoning.match(/(?:Draft\s*\d*\s*:?\s*|\*\*Draft\s*\d*\s*:?\*\*\s*|Final\s*Output\s*(?:\([^)]*\))?\s*:?\s*|\*\*Final\s*Output\s*(?:\([^)]*\))?\s*:?\*\*\s*)([^\n]+(?:\n[^\n]+)*)/i);
      let fallbackText = "";
      if (match && match[1]) {
        fallbackText = match[1].replace(/^[*\s]+|[*\s]+$/g, "").trim();
      } else {
        // Grab last non-numbered non-bold line
        const lines = accumulatedReasoning.split("\n").map((l) => l.trim()).filter(Boolean);
        fallbackText = lines[lines.length - 1] || "";
      }

      if (fallbackText) {
        accumulatedContent = fallbackText;
        const endTag = "\n\n---\n\n";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: endTag, isReasoning: true })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: fallbackText })}\n\n`));
      }
    }

    try {
      await upstreamReader.cancel();
    } catch (e) {
      console.error("Error cancelling upstream reader on completion:", e);
    }

    const finalResult = { content: accumulatedContent, thinking: accumulatedReasoning || null };
    if (options?.onComplete) {
      try {
        await options.onComplete(finalResult);
      } catch (e) {
        console.error("Error in onComplete handler:", e);
      }
    }
    controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
    controller.close();
    fullTextResolve(finalResult);
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Race upstream stream read against 30-second inactivity watchdog timeout
        let watchdogTimer: NodeJS.Timeout | null = null;
        const readPromise = upstreamReader.read();
        const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array; timeout: boolean }>((resolve) => {
          watchdogTimer = setTimeout(() => resolve({ done: true, timeout: true }), 30000);
        });

        const result = await Promise.race([readPromise, timeoutPromise]);
        if (watchdogTimer) clearTimeout(watchdogTimer);

        if ("timeout" in result && result.timeout) {
          console.warn("[AI-Service] Upstream stream read timed out after 30s of inactivity");
          await handleFinish(controller);
          return;
        }

        const { done, value } = result;

        if (done) {
          await handleFinish(controller);
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") {
            if (trimmed === "data: [DONE]") {
              await handleFinish(controller);
              return;
            }
            continue;
          }

          if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              const reasoning =
                parsed.choices?.[0]?.delta?.reasoning ||
                parsed.choices?.[0]?.delta?.reasoning_content ||
                parsed.choices?.[0]?.delta?.thought;
              const finishReason = parsed.choices?.[0]?.finish_reason;

              if (reasoning) {
                if (!isReasoning) {
                  isReasoning = true;
                  const startTag = "\n*Thinking...*\n";
                  accumulated += startTag;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: startTag, isReasoning: true })}\n\n`));
                }
                accumulated += reasoning;
                accumulatedReasoning += reasoning;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: reasoning, isReasoning: true })}\n\n`));
              } else if (delta) {
                if (isReasoning) {
                  isReasoning = false;
                  const endTag = "\n\n---\n\n";
                  accumulated += endTag;
                  // End tag is still technically part of reasoning formatting
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: endTag, isReasoning: true })}\n\n`));
                }
                accumulated += delta;
                accumulatedContent += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`)
                );
              }
              
              // If OpenRouter signals the response is complete, aggressively close
              // the stream. This prevents the connection from hanging open for seconds
              // if they delay sending the final [DONE] event.
              if (finishReason) {
                await handleFinish(controller);
                return;
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        controller.error(err);
        if (!isCompleted) {
          isCompleted = true;
          const finalResult = { content: accumulatedContent, thinking: accumulatedReasoning || null };
          if (options?.onComplete) {
            Promise.resolve(options.onComplete(finalResult)).catch(console.error);
          }
        }
        fullTextResolve({ content: accumulatedContent, thinking: accumulatedReasoning || null });
      }
    },
    cancel() {
      upstreamReader.cancel();
      if (!isCompleted) {
        isCompleted = true;
        const finalResult = { content: accumulatedContent, thinking: accumulatedReasoning || null };
        if (options?.onComplete) {
          Promise.resolve(options.onComplete(finalResult)).catch(console.error);
        }
      }
      fullTextResolve({ content: accumulatedContent, thinking: accumulatedReasoning || null });
    },
  });

  return { stream, fullText };
}

/**
 * Build the system prompt for the AI interviewer persona.
 */
export function buildInterviewerSystemPrompt(config: {
  problemTitle: string;
  problemDescription: string;
  language: string;
  difficulty: string;
  style?: string;
  duration: number;
  timeRemainingSeconds?: number;
  voiceId?: string;
  tabSwitchCount?: number;
  outOfFrameCount?: number;
  multiplePeopleCount?: number;
  hintCount?: number;
}): string {
  // Build time-awareness context
  let timeContext = "";
  if (typeof config.timeRemainingSeconds === "number") {
    const mins = Math.floor(config.timeRemainingSeconds / 60);
    const secs = config.timeRemainingSeconds % 60;
    timeContext = `\nTIME REMAINING: ${mins} minutes and ${secs} seconds left.`;

    if (config.timeRemainingSeconds <= 30) {
      timeContext += `
TIME BEHAVIOR (FINAL 30 SECONDS):
- The interview is about to end. Say a brief, warm goodbye.
- Thank the candidate for their time and effort.
- Say something encouraging like "It was great working through this with you."
- Keep it to 1-2 sentences. Do NOT ask any more questions.`;
    } else if (config.timeRemainingSeconds <= 120) {
      timeContext += `
TIME BEHAVIOR (LAST 2 MINUTES):
- Begin wrapping up the interview naturally.
- Mention that time is almost up.
- Ask the candidate for any final thoughts on their solution.
- If they solved it, briefly summarize what went well.
- If they didn't solve it, be encouraging and acknowledge their effort.
- Do NOT introduce new complex topics or questions.`;
    } else if (config.timeRemainingSeconds <= 300) {
      timeContext += `
TIME BEHAVIOR (UNDER 5 MINUTES):
- Time is running low. Keep questions simple and focused.
- If the candidate is stuck, give them a stronger hint or help them move forward.
- Focus on what they have accomplished so far.
- Remind them gently about the remaining time if appropriate.`;
    }
  }

  // Build proctoring violations context for AI awareness
  const tabSwitches = config.tabSwitchCount ?? 0;
  const outOfFrame = config.outOfFrameCount ?? 0;
  const multiplePeople = config.multiplePeopleCount ?? 0;
  const hints = config.hintCount ?? 0;

  const proctoringContext = `
PROCTORING & INTEGRITY AUDIT DATA (FOR INTERVIEWER AWARENESS):
Candidate's current logged malpractice and assistance metrics:
- Tab Switches: ${tabSwitches} time(s)
- Out of Camera Frame: ${outOfFrame} second(s)
- Multiple Persons Detected: ${multiplePeople} time(s)
- Hints Requested: ${hints} time(s)

INSTRUCTION: You must keep these malpractice counts in mind for candidate evaluation and final scorecard generation. Do NOT output red warning cards, proctoring alert banners, or reprimands in your chat responses. Focus your conversation purely on technical problem-solving, code evaluation, and Socratic interview questions.`;

const INDIAN_VOICE_NAME_MAP: Record<string, string> = {
  am_adam: "Aarav",
  am_michael: "Rohan",
  am_fenrir: "Vikram",
  am_puck: "Kabir",
  am_echo: "Aditya",
  af_heart: "Ananya",
  af_bella: "Diya",
  af_sarah: "Isha",
  af_nicole: "Kavya",
  af_sky: "Meera",
  if_sara: "Priya",
  minimax_male_presenter: "Dev",
  minimax_female_shaonv: "Riya",
  minimax_female_yujie: "Sanya",
  gemini_alloy: "Neer",
  gemini_echo: "Siddharth",
  gemini_onyx: "Varun",
  gemini_nova: "Tara",
  gemini_shimmer: "Neha",
  local_male: "System Male",
  local_female: "System Female",
};

  const isFemale = config.voiceId && (config.voiceId.startsWith("af_") || config.voiceId.startsWith("if_") || config.voiceId.startsWith("bf_") || config.voiceId.includes("female") || config.voiceId === "gemini_nova" || config.voiceId === "gemini_shimmer");
  const mappedName = config.voiceId ? INDIAN_VOICE_NAME_MAP[config.voiceId] : undefined;
  const interviewerName = mappedName || (isFemale ? "Ananya" : "Aarav");

  let styleInstructions = "";
  if (config.style === "product") {
    styleInstructions = `
STYLE (Product-company/FAANG):
- Focus heavily on Data Structures and Algorithms (DSA).
- Emphasize time and space complexity optimization.
- Probe deeply on edge cases, large inputs, and strict constraints.
- Expect production-level code.`;
  } else if (config.style === "startup") {
    styleInstructions = `
STYLE (Startup):
- Focus on practical implementation and rapid problem-solving.
- Ask about trade-offs, tech debt, and how this fits into a larger system architecture.
- Prefer readable, maintainable, "get-it-done" code over hyper-optimized but unreadable code.`;
  } else if (config.style === "service") {
    styleInstructions = `
STYLE (Service-company):
- Focus on core fundamentals and language-specific nuances.
- Check for basic algorithmic understanding rather than highly complex dynamic programming.
- Ask questions about basic SQL concepts or general computing principles if appropriate.`;
  }

  return `You are a senior software engineer conducting a live coding interview. Your name is ${interviewerName}.

ROLE:
- You are a professional, calm, and encouraging technical interviewer.
- Simulate a real coding interview experience — NOT a chatbot conversation.
- Speak naturally and conversationally, as if in a video call.

INTERVIEW CONTEXT:
- Problem: "${config.problemTitle}"
- Difficulty: ${config.difficulty}
- Language: ${config.language}
- Duration: ${config.duration} minutes
${styleInstructions}
${timeContext}
${proctoringContext}

PROBLEM DETAILS:
${config.problemDescription}

PROGRESSIVE DIFFICULTY ESCALATION PATHS:
When the candidate completes or approaches a working solution, guide them through these structured escalation stages:
- Stage 1 (Edge Cases & Robustness): Probe how their code handles empty inputs, nulls, negative numbers, integer overflows, or duplicate elements.
- Stage 2 (Complexity & Optimization): Ask for Big-O time and space complexity. If their solution is sub-optimal (e.g., O(N^2)), challenge them to optimize to O(N log N) or O(N), or reduce auxiliary space to O(1).
- Stage 3 (System & Streaming Scale): Ask how their algorithm would adapt if inputs arrive as a continuous stream or exceed memory capacity.

BEHAVIOR RULES:
1. Start by briefly introducing yourself and the problem. Do NOT repeat the full problem text — the candidate can see it.
2. Ask the candidate to explain their approach before coding.
3. If the candidate is stuck, give small hints — never give the solution.
4. Ask follow-up questions about:
   - Time/space complexity
   - Edge cases
   - Alternative approaches
   - Code optimizations
5. When the candidate runs code and you see the execution result in the context, acknowledge it immediately. If it failed or threw a compilation error, reference the specific line number from the numbered code context to help them debug. If it passed, challenge them on edge cases or optimization.
6. Keep responses strictly concise — NEVER write more than 2 to 3 short paragraphs (maximum 2-4 sentences overall per response). Keep each response bite-sized and natural for verbal conversation.
7. Be encouraging but honest. Point out issues tactfully.
8. Do NOT write code for the candidate.
9. Do NOT use markdown formatting, code blocks, or bullet points. Speak naturally. Use conversational fillers (e.g., "umm", "hmm", "let's see", "ah") and natural pauses in your text so that the Text-to-Speech sounds human and realistic.
10. Address the candidate directly ("you", "your code", etc.).
11. You can see the candidate's code in the editor with line numbers. Reference specific line numbers (e.g. "On line 12...") when giving code feedback.
12. DIFFICULTY ADAPTATION: Monitor the candidate's performance. Follow the PROGRESSIVE DIFFICULTY ESCALATION PATHS above to guide their interview progression.

TONE: Professional, calm, encouraging. Like a real interviewer at a top tech company.`;
}

/**
 * Build the system prompt for generating the interview report.
 */
export function buildReportSystemPrompt(): string {
  return `You are an expert technical interviewer and evaluation system. Analyze the interview transcript and code submission to generate a highly accurate, structured performance report.

OUTPUT FORMAT (respond ONLY with valid JSON, no markdown formatting, no code blocks):
{
  "overallScore": <0-100>,
  "technicalScore": <0-100>,
  "communicationScore": <0-100>,
  "problemSolvingScore": <0-100>,
  "optimizationScore": <0-100>,
  "codeQualityScore": <0-100>,
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "summary": "2-3 sentence overall summary of the candidate's performance",
  "nextSteps": ["Actionable recommendation 1", "Actionable recommendation 2 (e.g. Leetcode problems)"],
  "transcriptAnnotations": [
    {
      "messageIndex": 2,
      "tag": "Missed Edge Case",
      "rationale": "The candidate didn't consider empty inputs here."
    }
  ],
  "timeComplexity": "e.g., O(N)",
  "spaceComplexity": "e.g., O(1)",
  "isSolved": true,
  "estimatedLevel": "Very Basic | Junior | Mid-Level | Senior"
}

SCORING GUIDELINES:
- Be strict and objective. Do not inflate scores. Deduct points for each hint used.
- 90-100: Exceptional (Optimal solution, no hints, perfect communication)
- 80-89: Strong (Optimal solution, minor hints, good communication)
- 70-79: Good (Working solution, some hints, minor gaps)
- 60-69: Average (Working but suboptimal solution, heavy hints)
- 50-59: Below Average (Incomplete or buggy solution)
- Below 50: Weak (Failed to grasp problem, major gaps)

EVALUATE:
- Technical: Algorithm choice, data structures, correctness
- Communication: Clarity, explaining thought process, asking clarifying questions
- Problem Solving: Breaking down problems, handling edge cases, adapting to hints
- Optimization: Time/space complexity awareness, proactive improvements
- Code Quality: Clean code, variable naming, structure, readability, modularity

CODE EVALUATION:
- Carefully analyze the candidate's final code provided under "FINAL CANDIDATE CODE SOLUTION SNAPSHOT".
- Evaluate variable naming, code structure, correctness, and edge-case handling to calculate codeQualityScore, timeComplexity, and spaceComplexity.
- If the candidate submitted no code or empty code, penalize codeQualityScore and set isSolved to false.

ADVANCED METRICS:
- "timeComplexity": Analyze the final code to determine the Big-O time complexity.
- "spaceComplexity": Analyze the final code to determine the Big-O space complexity (auxiliary space).
- "isSolved": Set to true ONLY if the candidate's final code effectively solves the core problem and handles standard edge cases.
- "estimatedLevel": Determine seniority based on performance:
  - Very Basic: Could not solve the problem or required extreme hand-holding. If you cannot determine, default to "Very Basic". Do not use "Unknown".
  - Junior: Needed heavy hints, missed edge cases, brute-force solutions.
  - Mid-Level: Solid execution, good communication, but maybe missed optimal approach or minor edge cases initially.
  - Senior: Wrote optimal code quickly, proactively handled edge cases, excellent communication of trade-offs.

ANNOTATIONS:
- The transcript contains messages prefixed with "[Msg X]".
- Create up to 5 transcriptAnnotations linking back to specific message indices where the candidate did something exceptionally well or poorly.
- Use tags like "Good Communication", "Red Flag", "Optimal Solution", "Missed Edge Case", "Hint Used".`;
}

export interface RubricEvaluationResult {
  isSatisfactory: boolean;
  score: number;
  matchedConcepts: string[];
  missedConcepts: string[];
  spokenFeedback: string;
}

/**
 * Evaluates candidate answer against admin-defined rubric in Hybrid Mode.
 * Determines if candidate covered key concepts or needs probing from a secondary angle.
 */
export async function evaluateAnswerRubric(params: {
  questionTitle: string;
  questionPrompt: string;
  expectedRubric: string[];
  secondaryProbe?: string | null;
  candidateAnswer: string;
  isRetry?: boolean;
  category?: string;
  options?: string[] | null;
  correctOption?: number | null;
}): Promise<RubricEvaluationResult> {
  const { questionTitle, questionPrompt, expectedRubric, secondaryProbe, candidateAnswer, isRetry, category, options, correctOption } = params;

  // Option Quiz Direct Evaluation
  if (category === "option_quiz" && typeof correctOption === "number" && Array.isArray(options)) {
    const correctText = options[correctOption] || "";
    const isCorrect =
      candidateAnswer.toLowerCase().includes(correctText.toLowerCase()) ||
      candidateAnswer.toLowerCase().includes(`option ${String.fromCharCode(65 + correctOption).toLowerCase()}`) ||
      candidateAnswer.toLowerCase().includes(`choice ${String.fromCharCode(65 + correctOption).toLowerCase()}`);

    if (isCorrect) {
      return {
        isSatisfactory: true,
        score: 100,
        matchedConcepts: [correctText],
        missedConcepts: [],
        spokenFeedback: `Spot on! Option ${String.fromCharCode(65 + correctOption)} is correct. Let's move to the next stage.`,
      };
    } else {
      return {
        isSatisfactory: isRetry ? true : false,
        score: 40,
        matchedConcepts: [],
        missedConcepts: [correctText],
        spokenFeedback: isRetry
          ? `The optimal answer is Option ${String.fromCharCode(65 + correctOption)} (${correctText}). Let's continue.`
          : secondaryProbe || `Take another look at the options. Which choice guarantees the best time complexity?`,
      };
    }
  }

  // Fallback defaults
  const fallbackResult: RubricEvaluationResult = {
    isSatisfactory: true,
    score: 80,
    matchedConcepts: expectedRubric || [],
    missedConcepts: [],
    spokenFeedback: "That's a reasonable explanation. Let's move on to the next part.",
  };

  if (!candidateAnswer || candidateAnswer.trim().length < 5) {
    return {
      isSatisfactory: false,
      score: 20,
      matchedConcepts: [],
      missedConcepts: expectedRubric || [],
      spokenFeedback: secondaryProbe || "Could you share your initial thoughts on this problem, or would you like me to clarify anything?",
    };
  }

  const prompt = `You are an expert technical interviewer evaluating a candidate's answer for the question: "${questionTitle}".

Question Prompt:
"${questionPrompt}"

Expected Rubric Points (Key Concepts):
${(expectedRubric || []).map((r, i) => `${i + 1}. ${r}`).join("\n")}t technical interviewer evaluating a candidate's answer for the question: "${questionTitle}".

Question Prompt:
"${questionPrompt}"

Expected Rubric Points (Key Concepts):
${(expectedRubric || []).map((r, i) => `${i + 1}. ${r}`).join("\n")}

Secondary Probing Angle to use if answer is incomplete or confused:
"${secondaryProbe || "Ask a gentle clarifying question to test their understanding."}"

Candidate's Spoken Answer:
"${candidateAnswer}"

${isRetry ? "NOTE: This is the candidate's second attempt. Be lenient and acknowledge their effort before moving on." : ""}

Respond with ONLY valid JSON with no markdown wrapping:
{
  "isSatisfactory": boolean,
  "score": number, // 0 to 100
  "matchedConcepts": ["concepts they covered"],
  "missedConcepts": ["concepts they missed"],
  "spokenFeedback": "What the AI interviewer should say out loud (1-2 sentences maximum. If satisfactory, praise briefly and transition. If incomplete/confused, ask from the secondary angle to guide them.)"
}`;

  try {
    const rawResponse = await deepseekChat(
      [
        { role: "system", content: "You are a precise technical interview evaluator. Output strict JSON only." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.2, maxTokens: 400 }
    );

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallbackResult;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isSatisfactory: Boolean(parsed.isSatisfactory),
      score: typeof parsed.score === "number" ? parsed.score : 75,
      matchedConcepts: Array.isArray(parsed.matchedConcepts) ? parsed.matchedConcepts : [],
      missedConcepts: Array.isArray(parsed.missedConcepts) ? parsed.missedConcepts : [],
      spokenFeedback: parsed.spokenFeedback || fallbackResult.spokenFeedback,
    };
  } catch (error) {
    console.warn("Rubric evaluation failed, using fallback:", error);
    return fallbackResult;
  }
}

