import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  deepseekChatStream,
  buildInterviewerSystemPrompt,
  type ChatMessage,
} from "@/services/ai-service";
import {
  getInterviewerSkill,
  buildDynamicToolInstructions,
} from "@/types/skills";
import { buildProfileInterviewDirective } from "@/lib/interview/profile-context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";
// No timeout limit on Render — standard Node.js runtime is fine
export const maxDuration = 300; // 5 minutes max (for safety)

/**
 * POST /api/interviews/[id]/chat
 * Unified chat route: validates user, saves user message, streams AI response,
 * and saves AI response to DB on completion.
 * Works on any hosting platform (Render, Railway, etc.) without Edge runtime.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { id } = await context.params;
    const body = await req.json();
    const {
      message,
      code,
      executionResult,
      timeRemainingSeconds,
      voiceId,
      tabSwitchCount: bodyTabSwitch,
      outOfFrameCount: bodyOutOfFrame,
      multiplePeopleCount: bodyMultiplePeople,
    } = body;

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify user and interview
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });

    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const interview = await prisma.interview.findUnique({
      where: { id, userId: user.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true },
        },
        jobRole: {
          include: {
            questions: {
              where: { isActive: true },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (!interview) {
      return new Response(JSON.stringify({ error: "Interview not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (interview.status !== "in_progress") {
      return new Response(JSON.stringify({ error: "Interview is not active" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Save user message to DB
    await prisma.message.create({
      data: {
        interviewId: id,
        role: "user",
        content: message,
      },
    });

    // Authoritative backend data loading directly from database (not from frontend chat payload)
    const dbTabSwitch = (interview as any).tabSwitchCount ?? 0;
    const dbOutOfFrame = (interview as any).outOfFrameCount ?? 0;
    const dbMultiplePeople = (interview as any).multiplePeopleCount ?? 0;

    const dbHintCount = await prisma.eventLog.count({
      where: {
        interviewId: id,
        eventType: "HINT_REQUESTED",
      },
    });

    // Check interview mode (Dynamic vs Hybrid)
    const modeSetting = await prisma.systemSetting.findUnique({
      where: { key: "INTERVIEW_MODE" },
    });
    const isDynamicMode = interview.jobRole?.mode === "dynamic" || modeSetting?.value === "dynamic";

    let dynamicInterviewerPrompt = "";
    if (isDynamicMode) {
      const [interviewerSkillSetting, targetSkillsSetting] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: "DYNAMIC_INTERVIEWER_SKILL" } }),
        prisma.systemSetting.findUnique({ where: { key: "DYNAMIC_TARGET_SKILLS" } }),
      ]);
      const activeSkillKey = interview.jobRole?.interviewerSkill || interviewerSkillSetting?.value || "startup_pragmatist";
      
      // Check database for custom AI Skill first, otherwise fallback to code registry
      const customDbSkill = await prisma.aiSkill.findFirst({
        where: { slug: activeSkillKey, isActive: true },
      });

      const skillPromptText = customDbSkill?.content || getInterviewerSkill(activeSkillKey).promptInstructions;
      const targetSkills =
        interview.jobRole?.targetSkills ||
        targetSkillsSetting?.value ||
        "System Architecture, Big-O Complexity, Code Modularity, Ambition & Ownership";

      dynamicInterviewerPrompt = `\n\n${skillPromptText}\n\nEVALUATION TARGET SKILLS FOR THIS SESSION:\n${targetSkills}\n\n${buildDynamicToolInstructions()}`;
    }

    // Build system prompt using authoritative backend DB data
    const baseSystemPrompt = buildInterviewerSystemPrompt({
      problemTitle: interview.problemTitle,
      problemDescription: interview.problemDescription,
      language: interview.language,
      difficulty: interview.difficulty,
      style: (interview as any).style,
      duration: interview.duration,
      timeRemainingSeconds:
        typeof timeRemainingSeconds === "number"
          ? timeRemainingSeconds
          : undefined,
      voiceId,
      tabSwitchCount: dbTabSwitch,
      outOfFrameCount: dbOutOfFrame,
      multiplePeopleCount: dbMultiplePeople,
      hintCount: dbHintCount,
    });

    // Load candidate's career profile & projects to enable personalized interview questions
    const studentProfile = await prisma.studentProfile.findUnique({
      where: { userId: user.id },
      include: {
        projects: { orderBy: { order: "asc" } },
        achievements: true,
      },
    });

    const profileDirective = buildProfileInterviewDirective(studentProfile ? {
      targetRole: studentProfile.targetRole,
      skills: Array.isArray(studentProfile.skills) ? (studentProfile.skills as string[]) : [],
      projects: studentProfile.projects,
      achievements: studentProfile.achievements,
    } : null);

    const [targetSkillsSetting, interviewerSkillSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: "DYNAMIC_TARGET_SKILLS" } }),
      prisma.systemSetting.findUnique({ where: { key: "DYNAMIC_INTERVIEWER_SKILL" } }),
    ]);

    const adminTargetSkills =
      interview.jobRole?.targetSkills ||
      targetSkillsSetting?.value ||
      "System Architecture, Big-O Complexity, Code Modularity, Ambition & Ownership";

    let adminTopicsDirective = `\n\nADMIN EVALUATION TARGET SKILLS FOR THIS INTERVIEW:\n${adminTargetSkills}\n`;
    if (interview.jobRole?.questions && interview.jobRole.questions.length > 0) {
      const topicsList = interview.jobRole.questions
        .map((q, idx) => `${idx + 1}. [${q.category.toUpperCase()}] ${q.title}: "${q.promptText.slice(0, 100)}..."`)
        .join("\n");
      adminTopicsDirective += `\nADMIN CONFIGURED STAGES & QUESTIONS TO PROBE:\n${topicsList}\n`;
    }

    const systemPrompt = isDynamicMode
      ? `${baseSystemPrompt}${dynamicInterviewerPrompt}${adminTopicsDirective}${profileDirective}`
      : `${baseSystemPrompt}${adminTopicsDirective}${profileDirective}`;

    // Build full user prompt combining message + editor code + execution result into a single payload
    let fullUserMessage = message;

    // Inject candidate's live code with line numbers so AI can reference line numbers accurately
    const liveCode = code || interview.code;
    if (liveCode && liveCode.trim().length > 0) {
      const numberedCode = liveCode
        .split("\n")
        .map((line: string, idx: number) => `${idx + 1}: ${line}`)
        .join("\n");
      fullUserMessage += `\n\n[CONTEXT — Candidate's current code in the editor (with line numbers)]:\n\`\`\`${interview.language}\n${numberedCode}\n\`\`\``;
    }

    // Inject code execution result context if candidate ran code
    if (executionResult) {
      const status = executionResult.statusDescription || "Completed";
      const stderr = executionResult.stderr || executionResult.compileOutput;
      const stdout = executionResult.stdout;
      
      const execSummary = stderr
        ? `[CONTEXT — Code execution completed with STATUS: "${status}"]: Error output:\n${stderr}`
        : stdout
          ? `[CONTEXT — Code execution SUCCESSFUL (Status: "${status}")]: Output:\n${stdout}\nExecution Time: ${executionResult.time || "<0.1"}s, Memory: ${executionResult.memory || 0} KB`
          : `[CONTEXT — Code execution completed with STATUS: "${status}" with no printed output]`;

      fullUserMessage += `\n\n${execSummary}`;
    }

    // Build conversation history ensuring valid role sequence
    const conversationHistory: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...interview.messages.map((m) => ({
        role: m.role as "assistant" | "user",
        content: m.content,
      })),
      { role: "user" as const, content: fullUserMessage },
    ];

    // Stream AI response and save to DB on completion
    try {
      const { stream } = await deepseekChatStream(conversationHistory, {
        temperature: 0.7,
        maxTokens: 2560,
        onComplete: async (result) => {
          try {
            // Clean tool call markup for persistent chat transcript
            const cleanContent = isDynamicMode
              ? result.content.replace(/\[TOOL_CALL:[\s\S]*?\]/gi, "").trim()
              : result.content;

            await prisma.message.create({
              data: {
                interviewId: id,
                role: "assistant",
                content: cleanContent || result.content,
                thinking: result.thinking,
              },
            });

            console.log(`[AI-Service] ✅ Response successfully saved to DB for interview ${id} (${cleanContent.length} chars)`);

            // Execute & persist dynamic tool calls to EventLog
            if (isDynamicMode) {
              const toolCallRegex = /\[TOOL_CALL:\s*([a-zA-Z0-9_]+)\((.*?)\)\]/gi;
              let match;
              while ((match = toolCallRegex.exec(result.content)) !== null) {
                const toolName = match[1];
                const argsStr = match[2];
                const argRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
                const args: Record<string, string> = {};
                let argMatch;
                while ((argMatch = argRegex.exec(argsStr)) !== null) {
                  args[argMatch[1]] = argMatch[2];
                }

                if (toolName === "switch_category") {
                  await prisma.eventLog.create({
                    data: {
                      interviewId: id,
                      eventType: "CATEGORY_SWITCH",
                      details: {
                        targetCategory: args.category || "code_editor",
                        reason: args.reason || "",
                      },
                    },
                  });
                  console.log(`[Dynamic-AI-Tool] Category switched to ${args.category}: ${args.reason}`);
                } else if (toolName === "record_recruiter_note") {
                  await prisma.eventLog.create({
                    data: {
                      interviewId: id,
                      eventType: "RECRUITER_NOTE",
                      details: {
                        trait: args.trait || "career_ambition",
                        quote: args.quote || "",
                        assessment: args.assessment || "",
                      },
                    },
                  });
                  console.log(`[Dynamic-AI-Tool] Recruiter note recorded for ${args.trait}`);
                } else if (toolName === "give_progressive_hint") {
                  await prisma.eventLog.create({
                    data: {
                      interviewId: id,
                      eventType: "HINT_REQUESTED",
                      details: {
                        level: args.level || "nudge",
                        hint: args.hint || "",
                      },
                    },
                  });
                  console.log(`[Dynamic-AI-Tool] Progressive hint provided: ${args.level}`);
                }
              }
            }

            // Save candidate's latest code snapshot
            if (liveCode) {
              await prisma.interview.update({
                where: { id },
                data: { code: liveCode },
              });
            }
          } catch (e) {
            console.error("Error saving AI message or logging tools to DB:", e);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      console.error("Streaming error:", error);
      const fallback =
        "I apologize, I'm having a brief technical issue. Could you repeat what you just said? Let's continue with the problem.";

      // 1. Save fallback message to DB to preserve chat context integrity
      try {
        await prisma.message.create({
          data: {
            interviewId: id,
            role: "assistant",
            content: fallback,
          },
        });
      } catch (dbErr) {
        console.error("Error saving fallback message to DB:", dbErr);
      }

      // 2. Stream fallback as valid text/event-stream SSE so frontend renders and speaks it smoothly
      const encoder = new TextEncoder();
      const fallbackStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ token: fallback })}\n\n`)
          );
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });

      return new Response(fallbackStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
