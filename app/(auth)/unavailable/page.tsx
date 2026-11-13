import { BrandLockup } from "@/components/brand/brand-lockup";
import { Suspense } from "react";
import { safeReturnTo } from "@/lib/portal/return-to";

async function TryAgain({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;

  return (
    <a href={safeReturnTo(returnTo)} className="text-sm font-medium underline">
      Try again
    </a>
  );
}

export default function UnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-md">
      <div className="flex max-w-[28rem] flex-col items-center space-y-sm text-center">
        <BrandLockup system="Enterprise Suite" className="mb-md" />
        <h1 className="text-headline-md text-foreground">HRMS is temporarily unavailable</h1>
        <p className="text-body-sm text-muted-foreground">
          HRMS could not reach the Portal to check your access, so nothing can be opened right
          now. Please try again in a moment.
        </p>
        <Suspense fallback={null}>
          <TryAgain searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
