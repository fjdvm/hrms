import { BrandLockup } from "@/components/brand/brand-lockup";
export default function NoAccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-md">
      <div className="flex max-w-[28rem] flex-col items-center space-y-sm text-center">
        <BrandLockup system="Enterprise Suite" className="mb-md" />
        <h1 className="text-headline-md text-foreground">You don&apos;t have access to this page</h1>
        <p className="text-body-sm text-muted-foreground">
          Your account has not been granted the Module this page belongs to. Ask the people who manage Staff access
          to grant it to you in the Portal.
        </p>
      </div>
    </main>
  );
}
