"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TRIGGER = "rounded-lg px-[14px] py-[8px] text-sm text-[#6e6680] data-[state=active]:bg-[#efe6f8] data-[state=active]:text-[#5b2a86] data-[state=active]:shadow-none";

/** The data is already on the page, so switching tabs never refetches. */
export function EmployeeTabs({ documentCount, details, documents, history, activity, training }: {
  documentCount: number; details: ReactNode; documents: ReactNode; history: ReactNode; activity: ReactNode;
  /** The Training history, only for Staff who hold the Training Module. */
  training?: ReactNode;
}) {
  return (
    <Tabs defaultValue="details" className="flex flex-col gap-[20px]">
      <TabsList aria-label="Employee record" className="h-auto flex-wrap justify-start gap-[4px] bg-transparent p-0">
        <TabsTrigger value="details" className={TRIGGER}>Details</TabsTrigger>
        <TabsTrigger value="documents" className={TRIGGER}>Documents {documentCount}</TabsTrigger>
        <TabsTrigger value="history" className={TRIGGER}>Employment history</TabsTrigger>
        <TabsTrigger value="activity" className={TRIGGER}>Activity</TabsTrigger>
        {training && <TabsTrigger value="training" className={TRIGGER}>Training history</TabsTrigger>}
      </TabsList>
      <TabsContent value="details" className="mt-0">{details}</TabsContent>
      <TabsContent value="documents" className="mt-0">{documents}</TabsContent>
      <TabsContent value="history" className="mt-0">{history}</TabsContent>
      <TabsContent value="activity" className="mt-0">{activity}</TabsContent>
      {training && <TabsContent value="training" className="mt-0">{training}</TabsContent>}
    </Tabs>
  );
}
