"use client";

import { useState } from "react";
import {
  Calendar,
  Check,
  Clock,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  EmailPreview,
  Field,
  FieldBox,
  HiringDialog,
  OptionGroup,
  ToggleRow,
} from "./dialog-parts";
import { PRE_EMPLOYMENT_DOCS } from "@/lib/hiring-mock";

type Trigger = { trigger: React.ReactNode };

const TEXT_FIELD = "h-auto rounded-lg border-zinc-200 bg-white px-[12px] py-[9px] text-sm text-zinc-900 shadow-none";

export function OfferResponseDialog({
  trigger,
  defaultAnswer = "accepted",
}: Trigger & { defaultAnswer?: "accepted" | "declined" }) {
  const [answer, setAnswer] = useState(defaultAnswer);

  return (
    <HiringDialog
      trigger={trigger}
      title="Offer response"
      subtitle="Ellaine Torres · Branch Cashier · ₱15,500 / month · start 10 Nov"
      footerNote={answer === "accepted" ? "The offer moves to Accepted." : "The offer moves to Declined."}
      submitLabel="Save response"
    >
      <Field label="Ellaine’s answer" required>
        <OptionGroup
          value={answer}
          onChange={setAnswer}
          options={[
            { value: "accepted", title: "Accepted", description: "Next, request her documents", icon: <Check className="text-[#1e6b3a]" /> },
            { value: "declined", title: "Declined", description: "Moves to Rejected", icon: <X className="text-red-700" /> },
          ]}
        />
      </Field>
      <Field label="Reply received">
        <FieldBox trailing={<Calendar className="size-4" />}>24 Oct 2026 · by phone</FieldBox>
      </Field>
      <ToggleRow
        title="Email Ellaine"
        description="A welcome email if accepted, a thank-you email if declined."
      />
      <Field label="Send email" hint="Sent later, not right away. You can edit or cancel it until then.">
        <FieldBox icon={<Clock className="size-4" />} trailing="chevron">
          Today, 24 Oct · 6:00 PM
        </FieldBox>
      </Field>
      <EmailPreview
        subject="Welcome to Bren Raphael’s, Ellaine!"
        body="Thank you for accepting our offer for Branch Cashier. We’ll send you a list of documents to submit before your first day on 10 Nov."
      />
    </HiringDialog>
  );
}

export function RequestDocumentsDialog({ trigger }: Trigger) {
  return (
    <HiringDialog
      trigger={trigger}
      title="Request documents"
      subtitle="Ellaine Torres · Branch Cashier · start 10 Nov"
      footerNote="5 documents · due 5 Nov"
      submitLabel="Send request"
    >
      <div className="flex flex-col gap-sm">
        <Field label="Documents to request" required>
          <ul className="overflow-hidden rounded-[10px] border border-zinc-200">
            {PRE_EMPLOYMENT_DOCS.map((doc) => (
              <li
                key={doc.name}
                className={`flex items-center gap-[12px] border-b border-border-subtle px-[14px] py-[10px] last:border-b-0 ${
                  doc.fromApplication ? "bg-zinc-50" : "bg-white"
                }`}
              >
                <Checkbox
                  aria-label={doc.name}
                  defaultChecked
                  disabled={doc.fromApplication}
                  className="size-4 rounded-[4px] shadow-none disabled:opacity-100 data-[state=checked]:disabled:border-zinc-200 data-[state=checked]:disabled:bg-zinc-200 data-[state=checked]:disabled:text-zinc-400 [&_svg]:size-3"
                />
                <span
                  className={`flex-1 text-sm font-medium ${doc.fromApplication ? "text-zinc-500" : "text-zinc-900"}`}
                >
                  {doc.name}
                </span>
                <span className="text-xs text-zinc-500">
                  {doc.fromApplication ? "Already submitted" : doc.hint}
                </span>
              </li>
            ))}
          </ul>
        </Field>
        <button type="button" className="cursor-pointer self-start text-[13px] font-medium text-primary hover:underline">
          + Add another document
        </button>
      </div>
      <Field label="Submit by" required hint="Five days before the start date.">
        <FieldBox trailing={<Calendar className="size-4" />}>5 Nov 2026</FieldBox>
      </Field>
      <Field label="Message" optionalHint="(optional)">
        <Textarea
          defaultValue="Hi Ellaine, please upload these before 5 Nov so we can prepare your first day. Thank you!"
          className={`${TEXT_FIELD} h-14 min-h-0 resize-none leading-5`}
        />
      </Field>
      <ToggleRow
        title="Email the request to Ellaine"
        description="Sent right away with a secure link to upload from her phone."
      />
    </HiringDialog>
  );
}

