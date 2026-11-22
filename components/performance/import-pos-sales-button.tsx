"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The Import POS sales button of the Top sales Empty state. The import dialog is its own ticket ("Import POS sales dialog and header
 * button"); until it lands this is the button's place, and that ticket gives it the dialog to open.
 */
export function ImportPosSalesButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button type="button" onClick={onClick} className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] shadow-none">
      <Upload aria-hidden className="size-4" />Import POS sales
    </Button>
  );
}
