"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

function Calendar({ className, classNames, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      className={cn("relative", className)}
      classNames={{
        months: "flex flex-col gap-4 sm:flex-row",
        month: "space-y-3",
        month_caption: "flex h-8 items-center justify-center text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous:
          "inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50",
        button_next: "inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50",
        month_grid: "border-collapse",
        weekday: "size-9 text-xs font-normal text-muted-foreground",
        day: "size-9 p-0 text-center text-sm",
        day_button:
          "inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        today: "font-semibold text-[#5b2a86]",
        outside: "text-muted-foreground opacity-50",
        range_start: "rounded-l-md bg-[#efe6f8] [&>button]:bg-[#5b2a86] [&>button]:text-white [&>button]:hover:bg-[#5b2a86]",
        range_end: "rounded-r-md bg-[#efe6f8] [&>button]:bg-[#5b2a86] [&>button]:text-white [&>button]:hover:bg-[#5b2a86]",
        range_middle: "bg-[#efe6f8] [&>button]:rounded-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  )
}

export { Calendar }
