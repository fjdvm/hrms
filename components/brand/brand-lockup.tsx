import Image from "next/image";

import { cn } from "@/lib/utils";

const SYSTEM_NAMES = {
  CREOMS: "Customer Relation & Ecommerce Ordering Management System",
  HRMS: "Human Resource Management System",
  IMS: "Inventory Management System",
  POS: "Point of Sale System",
  "Enterprise Suite": "Enterprise Suite",
} as const;

export type BrandSystem = keyof typeof SYSTEM_NAMES;

/**
 * The Figma "Logo/Lockup": chef tile, "Bren Raphael's" and the system name beside it.
 * Light is for white backgrounds, Dark for purple backgrounds.
 */
export function BrandLockup({
  system,
  tone = "Light",
  className,
}: {
  system: BrandSystem;
  tone?: "Light" | "Dark";
  className?: string;
}) {
  const dark = tone === "Dark";

  return (
    <div className={cn("flex items-center gap-3 text-left", className)}>
      <div
        className={cn(
          "relative size-12 shrink-0 overflow-hidden rounded-[12px] bg-white",
          !dark && "border border-[#ece6f2]",
        )}
      >
        <Image
          src="/images/brand/logo-tile.png"
          alt=""
          fill
          sizes="48px"
          className="object-contain p-[3px]"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px] font-semibold">
        <p
          className={cn(
            "whitespace-nowrap font-[family-name:var(--font-fraunces)] text-[20px] leading-normal",
            dark ? "text-white" : "text-[#2a0f3f]",
          )}
          style={{ fontVariationSettings: '"SOFT" 0, "WONK" 1' }}
        >
          Bren Raphael&apos;s
        </p>
        <p
          className={cn(
            "text-[9px] uppercase leading-[12px] tracking-[1.1px]",
            dark ? "text-[#cdb8e6]" : "text-[#7a5899]",
          )}
        >
          {SYSTEM_NAMES[system]}
        </p>
      </div>
    </div>
  );
}
