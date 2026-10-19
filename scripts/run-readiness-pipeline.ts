/**
 * Seed and execute the complete placement readiness pipeline for the user's resume:
 * 1. Read the user uploaded PDF (/Users/pravinghodake/.gemini/antigravity-ide/brain/3f028754-a588-4c68-bc5f-076b63f933e9/.user_uploaded/media_1791626121658.pdf)
 * 2. Parse text, page count, and skills using pdf-parser.ts
 * 3. Save to StudentProfile in database with projects, github, and target role
 * 4. Run the full AI benchmark review (resumeCheck, codebaseCheck, liveLinkCheck, linkedinCheck)
 * 5. Compute the authoritative 100-point Readiness Score
 * 6. Verify end-to-end output
 */
import fs from "fs";
import { prisma } from "../lib/prisma";
import { parseResumePdf } from "../lib/profile/pdf-parser";
import { runFullAudit } from "../lib/review/full-auditor";
import { calculateReadinessMetrics } from "../lib/scoring/readiness";

async function main() {
  console.log("==================================================================");
  console.log("STEP 1: Reading user uploaded PDF and parsing resume...");
  console.log("==================================================================");

  const pdfPath = "/Users/pravinghodake/.gemini/antigravity-ide/brain/3f028754-a588-4c68-bc5f-076b63f933e9/.user_uploaded/media_1791626121658.pdf";
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found at ${pdfPath}`);
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  const parsed = await parseResumePdf(pdfBuffer);
  console.log(`✓ Parsed PDF: ${parsed.pageCount} pages, ${parsed.text.length} characters`);
  console.log(`✓ Extracted Skills:`, parsed.detectedSkills);

  // Get active user (Pravin Ghodake)
  const user = await prisma.user.findFirst({
    where: { email: "ghodakepravin153@gmail.com" },
  });

  if (!user) {
    throw new Error("Target user ghodakepravin153@gmail.com not found in database");
  }
  console.log(`✓ Found user: ${user.name} (${user.id})`);

  console.log("\n==================================================================");
  console.log("STEP 2: Updating StudentProfile in Database...");
  console.log("==================================================================");

  const combinedSkills = Array.from(
    new Set([
      ...parsed.detectedSkills,
      "React",
      "Next.js",
      "TypeScript",
      "Node.js",
      "PostgreSQL",
      "Docker",
    ])
  );

  const profile = await prisma.studentProfile.upsert({
    where: { userId: user.id },
    update: {
      resumeFileName: "Pravin_Ghodake_Resume.pdf",
      resumeText: parsed.text,
      resumePageCount: parsed.pageCount,
      targetRole: "Full Stack Engineer",
      skills: combinedSkills,
      githubUsername: "Pravinghodake153",
      leetcodeUsername: "pravinghodake",
      linkedinUrl: "https://linkedin.com/in/pravinghodake",
    },
    create: {
      userId: user.id,
      resumeFileName: "Pravin_Ghodake_Resume.pdf",
      resumeText: parsed.text,
      resumePageCount: parsed.pageCount,
      targetRole: "Full Stack Engineer",
      skills: combinedSkills,
      githubUsername: "Pravinghodake153",
      leetcodeUsername: "pravinghodake",
      linkedinUrl: "https://linkedin.com/in/pravinghodake",
    },
  });
  console.log(`✓ Profile synced: ID ${profile.id} with ${combinedSkills.length} skills`);

  // Ensure portfolio projects exist
  const existingProjects = await prisma.studentProject.findMany({
    where: { profileId: profile.id },
  });

  if (existingProjects.length === 0) {
    await prisma.studentProject.create({
      data: {
        profileId: profile.id,
        title: "AlgoPilot — AI Interview Simulator",
        description: "Full-stack AI mock interview platform with real-time speech feedback, interactive code sandbox, and placement readiness engine.",
        repoUrl: "https://github.com/Pravinghodake153/interview_pilot",
        liveUrl: "https://algopilot-one.vercel.app",
        techStack: ["Next.js", "TypeScript", "Prisma", "PostgreSQL", "Docker"],
        order: 1,
      },
    });
    console.log("✓ Added project: AlgoPilot — AI Interview Simulator");
  } else {
    await prisma.studentProject.update({
      where: { id: existingProjects[0].id },
      data: {
        title: "AlgoPilot — AI Interview Simulator",
        repoUrl: "https://github.com/Pravinghodake153/interview_pilot",
        liveUrl: "https://algopilot-one.vercel.app",
        techStack: ["Next.js", "TypeScript", "Prisma", "PostgreSQL", "Docker"],
      },
    });
    console.log("✓ Updated project links with live repo & production demo");
  }

  console.log("\n==================================================================");
  console.log("STEP 3: Running Benchmark Review (Resume, Codebase, Links, LinkedIn)...");
  console.log("==================================================================");

  const updatedProfile = await prisma.studentProfile.findUnique({
    where: { id: profile.id },
    include: { projects: true, achievements: true },
  });

  if (!updatedProfile) throw new Error("Could not reload profile");

  const auditReport = await runFullAudit({
    id: updatedProfile.id,
    userId: updatedProfile.userId,
    resumeText: updatedProfile.resumeText,
    resumePageCount: updatedProfile.resumePageCount,
    targetRole: updatedProfile.targetRole,
    skills: (updatedProfile.skills as string[]) || [],
    githubUsername: updatedProfile.githubUsername,
    linkedinUrl: updatedProfile.linkedinUrl,
    projects: updatedProfile.projects as any,
    achievements: updatedProfile.achievements as any,
  });

  console.log(`✓ Audit complete! Overall Audit Score: ${auditReport.overallScore}/100`);
  console.log(`- Resume Check Score: ${auditReport.resumeCheck.score}/100`);
  console.log(`- Codebase Check Score: ${auditReport.codebaseCheck.score}/100`);
  console.log(`- Live Link Check Score: ${auditReport.liveLinkCheck.score}/100`);
  console.log(`- LinkedIn Check Score: ${auditReport.linkedinCheck.score}/100`);

  // Persist ProfileReview in DB
  const savedReview = await prisma.profileReview.create({
    data: {
      profileId: updatedProfile.id,
      resumeCheck: auditReport.resumeCheck as any,
      codebaseCheck: auditReport.codebaseCheck as any,
      liveLinkCheck: auditReport.liveLinkCheck as any,
      linkedinCheck: auditReport.linkedinCheck as any,
      overallReview: auditReport.overallReview,
    },
  });
  console.log(`✓ Saved review report: ID ${savedReview.id}`);

  console.log("\n==================================================================");
  console.log("STEP 4: Calculating Authoritative Placement Readiness Score...");
  console.log("==================================================================");

  // Fetch interviews for this user
  const dbInterviews = await prisma.interview.findMany({
    where: { userId: user.id },
    include: {
      report: { select: { overallScore: true } },
    },
  });

  const userInterviews = dbInterviews.map(i => ({
    status: i.status,
    score: i.report?.overallScore || 0,
  }));

  const readiness = calculateReadinessMetrics(
    updatedProfile as any,
    {
      resumeScore: auditReport.resumeCheck.score,
      projectsScore: auditReport.liveLinkCheck.score,
      interviewScore: userInterviews.length > 0 ? (userInterviews[0].score || 70) : 70,
      githubScore: auditReport.codebaseCheck.score,
      linkedinScore: auditReport.linkedinCheck.score,
    }
  );

  console.log(`✓ Calculated Readiness Score: ${readiness.overallScore}/100 (${readiness.tier})`);
  readiness.components.forEach((c) => {
    console.log(`  • ${c.name} (Weight ${c.weight}%): ${c.score}/100 [Contribution: ${c.weightedScore.toFixed(1)} pts]`);
  });

  const getScoreByCategory = (cat: string) => readiness.components.find(c => c.category === cat)?.score || 0;

  // Upsert ReadinessScore in DB
  await prisma.readinessScore.upsert({
    where: { profileId: updatedProfile.id },
    update: {
      overallScore: readiness.overallScore,
      tier: readiness.tier,
      resumeScore: getScoreByCategory("resume"),
      projectsScore: getScoreByCategory("projects"),
      interviewScore: getScoreByCategory("interview"),
      githubScore: getScoreByCategory("github"),
      leetcodeScore: getScoreByCategory("leetcode"),
      linkedinScore: getScoreByCategory("linkedin"),
      achievementsScore: getScoreByCategory("achievements"),
      topFixes: readiness.topFixes as any,
    },
    create: {
      profileId: updatedProfile.id,
      overallScore: readiness.overallScore,
      tier: readiness.tier,
      resumeScore: getScoreByCategory("resume"),
      projectsScore: getScoreByCategory("projects"),
      interviewScore: getScoreByCategory("interview"),
      githubScore: getScoreByCategory("github"),
      leetcodeScore: getScoreByCategory("leetcode"),
      linkedinScore: getScoreByCategory("linkedin"),
      achievementsScore: getScoreByCategory("achievements"),
      topFixes: readiness.topFixes as any,
    },
  });

  console.log("\n==================================================================");
  console.log("PIPELINE EXECUTION COMPLETE & FULLY READY!");
  console.log("==================================================================");
}

main()
  .catch((e) => {
    console.error("Pipeline execution failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
