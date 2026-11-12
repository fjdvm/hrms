"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-sm p-md sm:p-lg">
      <h1 className="text-headline-md">Onboarding could not be loaded</h1>
      <p className="text-body-sm text-muted-foreground">Something went wrong. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
