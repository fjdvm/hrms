import { BrandLockup } from "@/components/brand/brand-lockup";
import { Suspense } from "react";
import { LOGIN_PATH } from "@/lib/portal/config";

const MESSAGES: Record<string, { title: string; body: string }> = {
  denied: {
    title: "You don't have access to HRMS",
    body: "The Portal did not grant you access. Ask for an HRMS Module to be granted to you at the Portal.",
  },
  unavailable: {
    title: "Sign-in is temporarily unavailable",
    body: "HRMS could not reach the Portal. Please try again in a moment.",
  },
  failed: {
    title: "Sign-in could not be completed",
    body: "The sign-in link may have expired or already been used. Please sign in again.",
  },
};

async function Message({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const message = MESSAGES[reason ?? ""] ?? MESSAGES.failed;

  return (
    <>
      <h1 className="text-headline-md text-foreground">{message.title}</h1>
      <p className="text-body-sm text-muted-foreground">{message.body}</p>
    </>
  );
}

export default function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-md">
      <div className="flex max-w-[28rem] flex-col items-center space-y-sm text-center">
        <BrandLockup system="Enterprise Suite" className="mb-md" />
        <Suspense fallback={null}>
          <Message searchParams={searchParams} />
        </Suspense>
        <a href={LOGIN_PATH} className="text-sm font-medium underline">
          Try signing in again
        </a>
      </div>
    </main>
  );
}
