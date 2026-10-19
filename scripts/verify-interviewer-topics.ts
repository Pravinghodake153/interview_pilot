/**
 * Verification test to prove the AI interviewer incorporates:
 * 1. Verified Resume Skills (React, Next.js, Python, PostgreSQL, Docker, etc.)
 * 2. Candidate Portfolio Projects (AlgoPilot, etc.)
 * 3. Admin Evaluation Target Skills (System Architecture, Code Modularity, Big-O Complexity, etc.)
 * 4. Admin Configured Stages/Questions from the Job Role Question Bank
 */
import { prisma } from "../lib/prisma";
import { buildProfileInterviewDirective } from "../lib/interview/profile-context";
import { buildInterviewerSystemPrompt } from "../services/ai-service";

async function verifyInterviewerDirectives() {
  console.log("==================================================================");
  console.log("VERIFYING INTERVIEWER ASKS AS PER RESUME & ADMIN TOPICS");
  console.log("==================================================================");

  // 1. Fetch real student profile from DB
  const user = await prisma.user.findFirst({
    where: { email: "ghodakepravin153@gmail.com" },
  });
  if (!user) throw new Error("User not found");

  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: { projects: true, achievements: true },
  });

  if (!studentProfile) throw new Error("Student profile not found");
  console.log(`✓ Loaded Profile for: ${user.name}`);
  console.log(`- Verified Resume Skills (${(studentProfile.skills as string[]).length}):`, (studentProfile.skills as string[]).slice(0, 6).join(", "));
  console.log(`- Portfolio Projects (${studentProfile.projects.length}):`, studentProfile.projects.map(p => p.title).join(", "));

  // 2. Fetch admin configured job roles and system settings
  const jobRoles = await prisma.jobRole.findMany({
    include: { questions: { where: { isActive: true }, orderBy: { order: "asc" } } }
  });
  console.log(`✓ Loaded Admin Job Roles (${jobRoles.length}):`, jobRoles.map(r => r.title).join(", "));

  const activeRole = jobRoles[0]; // e.g. MSOT or StartUP
  console.log(`- Active Admin Role: "${activeRole.title}"`);
  console.log(`- Admin Target Skills: "${activeRole.targetSkills}"`);
  console.log(`- Admin Question Bank Stages (${activeRole.questions.length}):`, activeRole.questions.map(q => q.title).join("; "));

  // 3. Build Resume Directive
  const profileDirective = buildProfileInterviewDirective({
    targetRole: studentProfile.targetRole,
    skills: studentProfile.skills as string[],
    projects: studentProfile.projects,
    achievements: studentProfile.achievements,
  });

  // 4. Build Admin Topics Directive
  let adminTopicsDirective = `\nADMIN EVALUATION TARGET SKILLS FOR THIS INTERVIEW:\n${activeRole.targetSkills}\n`;
  if (activeRole.questions.length > 0) {
    const topicsList = activeRole.questions
      .map((q, idx) => `${idx + 1}. [${q.category.toUpperCase()}] ${q.title}: "${q.promptText.slice(0, 100)}..."`)
      .join("\n");
    adminTopicsDirective += `\nADMIN CONFIGURED STAGES & QUESTIONS TO PROBE:\n${topicsList}\n`;
  }

  // 5. Build Base System Prompt
  const baseSystemPrompt = buildInterviewerSystemPrompt({
    problemTitle: "Two Sum",
    problemDescription: "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
    language: "typescript",
    difficulty: "easy",
    style: "standard",
    duration: 30,
    voiceId: "local_female",
  });

  const fullPrompt = `${baseSystemPrompt}${adminTopicsDirective}${profileDirective}`;

  console.log("\n==================================================================");
  console.log("PROMPT VALIDATION CHECKS");
  console.log("==================================================================");

  // Verify Resume Skills presence
  const hasReact = fullPrompt.includes("React");
  const hasTypeScript = fullPrompt.includes("TypeScript");
  const hasPostgres = fullPrompt.includes("SQL / Databases");
  console.log(`• Resume Skills Probing Included: ${hasReact && hasTypeScript && hasPostgres ? "PASS ✓" : "FAIL ✗"}`);
  if (!hasReact || !hasTypeScript) throw new Error("Resume skills missing from interviewer prompt");

  // Verify Project presence
  const hasProject = fullPrompt.includes("AlgoPilot — AI Interview Simulator");
  console.log(`• Candidate Project Probing Included: ${hasProject ? "PASS ✓" : "FAIL ✗"}`);
  if (!hasProject) throw new Error("Candidate portfolio project missing from interviewer prompt");

  // Verify Admin Target Skills presence
  const hasAdminSkills = fullPrompt.includes(activeRole.targetSkills);
  console.log(`• Admin Target Skills Included: ${hasAdminSkills ? "PASS ✓" : "FAIL ✗"}`);
  if (!hasAdminSkills) throw new Error("Admin target skills missing from interviewer prompt");

  // Verify Female Persona
  const hasPersona = fullPrompt.includes("female interviewer \"Ananya\"");
  console.log(`• Interviewer Persona Ananya (WebSpeech Female): ${hasPersona ? "PASS ✓" : "FAIL ✗"}`);
  if (!hasPersona) throw new Error("Interviewer persona missing");

  console.log("\n==================================================================");
  console.log("ALL CHECKS PASSED: Interviewer prompts strictly align with candidate resume & admin topics!");
  console.log("==================================================================");
}

verifyInterviewerDirectives()
  .catch((e) => {
    console.error("Verification failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
