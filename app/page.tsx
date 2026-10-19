import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function HomePage() {
  const { userId } = await auth();
  const isUserSignedIn = !!userId;

  return (
    <div className="flex min-h-screen flex-col items-center justify-between p-6">
      {/* Top Navigation */}
      <header className="flex w-full max-w-6xl items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary"
          >
            <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
          </svg>
          <span className="font-bold tracking-tight">AlgoPilot</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {!isUserSignedIn ? (
            <>
              <Link
                href="/sign-in"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 text-xs font-medium text-background transition-colors hover:bg-foreground/90 cursor-pointer"
              >
                Sign Up
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Dashboard
              </Link>
              <UserButton />
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex flex-col items-center gap-8">
          <div className="flex items-center gap-4 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            <span>AlgoPilot V1.0 MVP</span>
          </div>

          <h1 className="max-w-3xl text-5xl font-extrabold tracking-tight md:text-6xl">
            Simulate realistic coding interviews with AI
          </h1>

          <p className="max-w-lg text-lg text-muted-foreground">
            A premium desktop coding interview simulator. Practice speaking or typing solutions to algorithm problems with real-time audio feedback.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row">
            {isUserSignedIn ? (
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Go to Dashboard
              </Link>
            ) : (
              <Link
                href="/sign-up"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              >
                Start Practicing Free
              </Link>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full text-center text-xs text-muted-foreground/60 py-4">
        © {new Date().getFullYear()} AlgoPilot. Built for $0 speech & hosting costs.
      </footer>
    </div>
  );
}
