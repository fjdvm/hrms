import { describe, expect, it } from "vitest";
import { formatSource, readApplicantForm, canRecordResult, SCORE_LABELS, canReject, interviewRow, readInterviewForm, type InterviewForm, stageActions, invitePreview, isBookableDay, manilaParts, manilaToday, slotLabel, applicantsHref, exportFileName, exportHref, detailOrDash, formatAppliedFor, formatAvailableFrom, formatFileSize, formatSalary, trackerSteps, formatApplied, formatRange, formatShowing, activityEntries, dayTime, formatSubtitle, jobFromParam, pageCount, pageFromParam, searchFromParam, stageFromParam } from "@/lib/application-view";

describe("application list view", () => {
  it("reads the page from the URL, defaulting to the first", () => {
    expect(pageFromParam("3")).toBe(3);
    for (const bad of [undefined, "", "0", "-2", "1.5", "abc", "99999999999"]) expect(pageFromParam(bad)).toBe(1);
  });

  it("words the subtitle", () => {
    expect(formatSubtitle(132, 18)).toBe("132 applicants · 18 new this week");
    expect(formatSubtitle(1, 0)).toBe("1 applicant · 0 new this week");
  });

  it("formats the applied date in Manila time", () => {
    expect(formatApplied(new Date("2026-10-21T17:00:00Z"))).toBe("22 Oct 2026");
  });

  it("describes the visible range", () => {
    expect(formatRange(2, 25, 60, 25)).toBe("Showing 26–50 of 60 applicants");
    expect(formatRange(3, 25, 60, 10)).toBe("Showing 51–60 of 60 applicants");
    expect(formatRange(1, 25, 0, 0)).toBe("No applicants");
    expect(formatRange(9, 25, 60, 0)).toBe("60 applicants");
  });

  it("counts at least one page", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });

  it("reads the Stage tab from the URL, defaulting to All", () => {
    expect(stageFromParam("Screening")).toBe("Screening");
    for (const bad of [undefined, "", "screening", "Withdrawn", "nope"]) expect(stageFromParam(bad)).toBe("All");
  });

  it("trims the search from the URL and treats blank as none", () => {
    expect(searchFromParam("  maria ")).toBe("maria");
    expect(searchFromParam("   ")).toBeUndefined();
    expect(searchFromParam(undefined)).toBeUndefined();
  });

  it("builds list links that keep Stage and search and omit defaults", () => {
    expect(applicantsHref({})).toBe("/applicants");
    expect(applicantsHref({ stage: "All", page: 1 })).toBe("/applicants");
    expect(applicantsHref({ stage: "Offer", search: "a&b", page: 3 })).toBe("/applicants?stage=Offer&q=a%26b&page=3");
  });

  it("keeps the Job in list links and reads it from the URL", () => {
    expect(applicantsHref({ job: "12", stage: "Offer", search: "ana", page: 2 })).toBe("/applicants?stage=Offer&q=ana&job=12&page=2");
    expect(applicantsHref({ job: "12" })).toBe("/applicants?job=12");
    expect(jobFromParam(" 12 ")).toBe("12");
    expect(jobFromParam("  ")).toBeUndefined();
    expect(jobFromParam(undefined)).toBeUndefined();
  });

  it("words the Showing line", () => {
    expect(formatShowing(132)).toBe("Showing 132 applicants");
    expect(formatShowing(1)).toBe("Showing 1 applicant");
    expect(formatShowing(0)).toBe("Showing 0 applicants");
  });

  it("links the export to the current Stage, search and Job, never a page", () => {
    expect(exportHref({})).toBe("/api/applications/export");
    expect(exportHref({ stage: "Screening", search: "ana", job: "7" })).toBe("/api/applications/export?stage=Screening&q=ana&job=7");
  });

  it("dates the export file in Manila time", () => {
    expect(exportFileName(new Date("2026-10-21T17:00:00Z"))).toBe("applicants-2026-10-22.csv");
  });
});

describe("application profile view", () => {
  const dates = {
    New: new Date("2026-10-20T01:00:00Z"),
    Screening: new Date("2026-10-23T01:00:00Z"),
    Interview: new Date("2026-10-30T02:00:00Z"),
  };

  it("fills reached steps, marks the current one and leaves later steps empty", () => {
    expect(trackerSteps("Interview", dates)).toEqual([
      { label: "Applied", state: "done", date: "20 Oct" },
      { label: "Screening", state: "done", date: "23 Oct" },
      { label: "Interview", state: "current", date: "30 Oct, 10:00 AM" },
      { label: "Offer", state: "upcoming", date: "—" },
      { label: "Hired", state: "upcoming", date: "—" },
    ]);
  });

  it("shows a hired Application as complete", () => {
    expect(trackerSteps("Hired", { ...dates, Offer: dates.Interview, Hired: dates.Interview }).map((step) => step.state))
      .toEqual(["done", "done", "done", "done", "done"]);
  });

  it("keeps the steps a rejected Application reached and marks none current", () => {
    expect(trackerSteps("Rejected", { New: dates.New, Screening: dates.Screening, Rejected: dates.Interview }).map((step) => step.state))
      .toEqual(["done", "done", "upcoming", "upcoming", "upcoming"]);
  });

  it("formats details, with dashes for missing ones", () => {
    expect(formatSalary(16000)).toBe("₱16,000 / month");
    expect(formatSalary(null)).toBe("—");
    expect(formatAvailableFrom("2026-11-03")).toBe("3 Nov 2026");
    expect(formatAvailableFrom(null)).toBe("—");
    expect(formatAvailableFrom("soon")).toBe("—");
    expect(detailOrDash("  ")).toBe("—");
    expect(formatAppliedFor("Branch Cashier", "Cainta branch", new Date("2026-10-20T01:00:00Z"))).toBe("Applied for Branch Cashier · Cainta branch · 20 Oct 2026");
  });

  it("sizes a file the way the Documents card reads it", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(312 * 1024)).toBe("312 KB");
    expect(formatFileSize(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(0)).toBe("0 B");
  });

  describe("activity timeline", () => {
    const base = { jobPostingTitle: "Branch Cashier", appliedAt: dates.New };
    const interview = { id: 7, startsAt: dates.Interview, endsAt: new Date("2026-10-30T02:45:00Z"), type: "In person" as const, interviewerName: "Paolo Garcia", location: "Cainta branch", interviewerId: null, meetingLink: null, mapLink: null, province: null, city: null, address: null, privateNotes: null, resultEmailAt: null, score: 4, result: "Passed" as const };
    const event = (over: object) => ({ id: 1, fromStage: "New", toStage: "Screening", actorName: "Liza Bautista", reason: null, occurredAt: dates.Screening, ...over }) as never;

    it("holds only the application entry when nothing has happened", () => {
      expect(activityEntries({ ...base, interviews: [], activity: [] })).toEqual([{ tone: "purple", title: "Applied", detail: "20 Oct · Branch Cashier" }]);
    });

    it("reads Stage moves with who did them, and ends with the application", () => {
      expect(activityEntries({ ...base, interviews: [], activity: [event({ id: 2, fromStage: "Screening", toStage: "Offer", occurredAt: dates.Interview }), event({})] }).map((entry) => [entry.tone, entry.title, entry.detail])).toEqual([
        ["blue", "Moved to Offer", "30 Oct · by Liza Bautista"],
        ["blue", "Moved to Screening", "23 Oct · by Liza Bautista"],
        ["purple", "Applied", "20 Oct · Branch Cashier"],
      ]);
    });

    it("shows scheduling, with the move it caused, and the recorded result", () => {
      const entries = activityEntries({ ...base, interviews: [interview], activity: [
        event({ id: 3, fromStage: "Interview", toStage: "Interview", interviewId: 7, reason: "Interview result: Passed (score: 4/5)", occurredAt: dates.Interview }),
        event({ id: 2, fromStage: "Screening", toStage: "Interview", interviewId: 7, occurredAt: dates.Screening }),
      ] });
      expect(entries.map((entry) => [entry.tone, entry.title, entry.detail])).toEqual([
        ["green", "In person interview completed", "30 Oct · Passed · score 4 / 5 · by Liza Bautista"],
        ["purple", "Interview scheduled", "23 Oct · 30 Oct, 10:00 AM at Cainta branch · by Liza Bautista"],
        ["blue", "Moved to Interview", "23 Oct · by Liza Bautista"],
        ["purple", "Applied", "20 Oct · Branch Cashier"],
      ]);
    });

    it("schedules another interview without a second move", () => {
      expect(activityEntries({ ...base, interviews: [interview], activity: [event({ fromStage: "Interview", toStage: "Interview", interviewId: 7 })] }).map((entry) => entry.title))
        .toEqual(["Interview scheduled", "Applied"]);
    });

    it("shows a rejection in red with its reason", () => {
      expect(activityEntries({ ...base, interviews: [], activity: [event({ toStage: "Rejected", reason: "Not a fit" })] })[0])
        .toEqual({ tone: "red", title: "Rejected", detail: "23 Oct · by Liza Bautista · Not a fit" });
    });
  });
});

describe("note time", () => {
  it("reads as a day and time in Manila", () => {
    expect(dayTime(new Date("2026-10-28T06:15:00Z"))).toBe("28 Oct, 2:15 PM");
  });
});

describe("rejecting from the profile", () => {
  it("is offered only while the Application is still in progress", () => {
    for (const stage of ["New", "Screening", "Interview", "Offer"] as const) expect(canReject(stage)).toBe(true);
    for (const stage of ["Hired", "Rejected", "Withdrawn"] as const) expect(canReject(stage)).toBe(false);
  });
});

describe("stageActions", () => {
  it("offers the forward buttons for each Stage", () => {
    expect(stageActions("New").map((a) => a.label)).toEqual(["Move to Screening"]);
    expect(stageActions("Screening").map((a) => a.label)).toEqual(["Move to Interview"]);
    expect(stageActions("Interview").map((a) => a.label)).toEqual(["Schedule interview", "Move to Offer"]);
  });

  it("offers Reschedule once booked and nothing to book once a result is recorded", () => {
    expect(stageActions("Interview", "booked").map((a) => a.label)).toEqual(["Reschedule interview", "Move to Offer"]);
    expect(stageActions("Interview", "done").map((a) => a.label)).toEqual(["Move to Offer"]);
  });

  it("offers no forward action from Offer onward", () => {
    for (const stage of ["Offer", "Hired", "Rejected", "Withdrawn"] as const) expect(stageActions(stage)).toEqual([]);
  });
});

describe("schedule interview form", () => {
  const now = Date.parse("2026-10-28T02:00:00Z"); // Wed 28 Oct 2026, 10:00 Manila
  const form: InterviewForm = { type: "Online", date: "2026-10-29", start: "15:00", end: "15:30", interviewerId: "staff-1", interviewerName: " Paolo Garcia ", meetingLink: "https://meet.google.com/xqp-rtke-vbn", province: "", city: "", address: "", mapLink: "" };
  const errorsOf = (changes: Partial<InterviewForm>) => readInterviewForm({ ...form, ...changes }, now).errors;

  it("builds an Online interview in Manila time with its meeting link", () => {
    expect(readInterviewForm(form, now)).toEqual({ input: { startsAt: "2026-10-29T15:00:00+08:00", endsAt: "2026-10-29T15:30:00+08:00", type: "Online", interviewerId: "staff-1", interviewerName: "Paolo Garcia", meetingLink: "https://meet.google.com/xqp-rtke-vbn" } });
  });

  it("builds an In person interview from province, city, address and an optional map link", () => {
    const place = { type: "In person" as const, meetingLink: "", province: "Rizal", city: "Cainta", address: " 12 Rizal Ave ", mapLink: "" };
    expect(readInterviewForm({ ...form, ...place }, now).input).toEqual({ startsAt: "2026-10-29T15:00:00+08:00", endsAt: "2026-10-29T15:30:00+08:00", type: "In person", interviewerId: "staff-1", interviewerName: "Paolo Garcia", province: "Rizal", city: "Cainta", address: "12 Rizal Ave" });
    expect(readInterviewForm({ ...form, ...place, mapLink: "https://maps.app.goo.gl/x" }, now).input?.mapLink).toBe("https://maps.app.goo.gl/x");
  });

  it("names every missing field", () => {
    expect(errorsOf({ date: "", start: "", end: "", interviewerId: "", meetingLink: "" })).toEqual({
      date: "Choose a date.", start: "Choose a start time.", end: "Choose an end time.", interviewer: "Choose an interviewer.", meetingLink: "Enter the meeting link.",
    });
    expect(errorsOf({ type: "In person", meetingLink: "" })).toEqual({ province: "Choose a province.", city: "Choose a city or municipality.", address: "Enter the street, building and barangay." });
  });

  it("refuses times outside 8 AM to 5 PM with a message", () => {
    expect(errorsOf({ start: "07:30", end: "08:30" })).toEqual({ start: "Start time must be 8:00 AM or later." });
    expect(errorsOf({ start: "16:30", end: "17:30" })).toEqual({ end: "End time must be 5:00 PM or earlier." });
    expect(errorsOf({ start: "17:00", end: "17:30" })).toEqual({ start: "Start time must be before 5:00 PM.", end: "End time must be 5:00 PM or earlier." });
    expect(errorsOf({ start: "08:00", end: "17:00" })).toBeUndefined();
    expect(errorsOf({ end: "15:00" })).toEqual({ end: "End time must be after the start." });
  });

  it("refuses past days, weekends and a start that has already passed today", () => {
    expect(errorsOf({ date: "2026-10-27" })).toEqual({ date: "Choose a weekday that is not in the past." });
    expect(errorsOf({ date: "2026-10-31" })).toEqual({ date: "Choose a weekday that is not in the past." }); // Saturday
    expect(errorsOf({ date: "2026-10-28", start: "09:00", end: "09:30" })).toEqual({ start: "That start time has already passed." });
    expect(errorsOf({ date: "2026-10-28", start: "10:30", end: "11:00" })).toBeUndefined();
  });

  it("requires links to be web addresses", () => {
    expect(errorsOf({ meetingLink: "meet me tomorrow" })).toEqual({ meetingLink: "Enter a valid link starting with https://." });
    expect(errorsOf({ type: "In person", meetingLink: "", province: "Rizal", city: "Cainta", address: "x", mapLink: "nope" })).toEqual({ mapLink: "Enter a valid link starting with https://." });
  });
});

describe("interview scheduling helpers", () => {
  it("tells a bookable day from a past day or a weekend, in Manila time", () => {
    const now = Date.parse("2026-10-28T18:00:00Z"); // 02:00 Thu 29 Oct in Manila
    expect(manilaToday(now)).toBe("2026-10-29");
    expect(isBookableDay("2026-10-28", now)).toBe(false);
    expect(isBookableDay("2026-10-29", now)).toBe(true);
    expect(isBookableDay("2026-10-31", now)).toBe(false);
    expect(isBookableDay("2026-11-01", now)).toBe(false);
    expect(isBookableDay("2026-11-02", now)).toBe(true);
    expect(isBookableDay("not a date", now)).toBe(false);
  });

  it("reads Manila date and time from an instant and labels a free slot", () => {
    expect(manilaParts("2026-10-29T07:30:00Z")).toEqual({ date: "2026-10-29", time: "15:30" });
    expect(slotLabel("2026-10-29T06:00:00Z", "2026-10-29T06:45:00Z")).toBe("Thu 29 Oct · 2:00 – 2:45 PM");
  });

  it("previews the invite in fixed wording for both interview types", () => {
    const base = { applicantName: "Ellaine Torres", jobTitle: "Branch Cashier", date: "2026-10-29", start: "15:00", end: "15:30", interviewerName: "Paolo Garcia", province: "Rizal", city: "Cainta", address: "12 Rizal Ave", mapLink: "", meetingLink: "https://meet.google.com/x" };
    const online = invitePreview({ ...base, type: "Online" });
    expect(online.subject).toBe("Your interview for Branch Cashier");
    expect(online.lines).toContain("Hi Ellaine,");
    expect(online.lines.join("\n")).toContain("Thursday, 29 October 2026, 3:00 PM – 3:30 PM (Manila time)");
    expect(online.lines).toContain("Join online: https://meet.google.com/x");
    expect(invitePreview({ ...base, type: "In person", mapLink: "https://maps.app.goo.gl/x" }).lines).toContain("Venue: 12 Rizal Ave, Cainta, Rizal\nMap: https://maps.app.goo.gl/x");
    expect(invitePreview({ ...base, type: "Online", date: "", meetingLink: "" }).lines.join("\n")).toContain("When: To be set");
  });
});

describe("interview rows", () => {
  const base = { id: 1, startsAt: new Date("2026-10-30T02:00:00Z"), endsAt: new Date("2026-10-30T02:45:00Z"), type: "In person" as const, interviewerName: "Paolo Garcia", location: "Cainta branch · https://maps.example/x", interviewerId: null, meetingLink: null, mapLink: null, province: null, city: null, address: null, privateNotes: null, resultEmailAt: null, score: null, result: null };

  it("reads a booked interview as Scheduled with no score", () => {
    expect(interviewRow(base)).toEqual({ date: "30 Oct 2026", time: "10:00 – 10:45 AM", type: "In person · Cainta branch", interviewer: "Paolo Garcia", score: "—", status: "Scheduled" });
  });

  it("reads a recorded result as Completed with its score", () => {
    expect(interviewRow({ ...base, score: 4, result: "Passed" })).toMatchObject({ score: "4 / 5", status: "Completed" });
  });

  it("offers a result only once the interview has started and has none", () => {
    const at = new Date("2026-10-30T02:00:00Z");
    expect(canRecordResult(base, new Date(at.getTime() - 1))).toBe(false);
    expect(canRecordResult(base, at)).toBe(true);
    expect(canRecordResult({ ...base, score: 4, result: "Passed" }, at)).toBe(false);
  });

  it("labels each score from 1 to 5", () => {
    expect(SCORE_LABELS).toEqual(["Poor", "Fair", "Good", "Strong", "Outstanding"]);
  });

  it("shows an Online interview as just Online", () => {
    expect(interviewRow({ ...base, type: "Online", location: "https://meet.example/abc" }).type).toBe("Online");
  });

  it("keeps am/pm on both ends when the interview crosses noon", () => {
    expect(interviewRow({ ...base, startsAt: new Date("2026-10-30T03:30:00Z"), endsAt: new Date("2026-10-30T04:15:00Z") }).time).toBe("11:30 AM – 12:15 PM");
  });
});

describe("add applicant form", () => {
  const form = { fullName: " Mylene Santos ", email: " mylene@example.com ", mobile: "0917 123 4567", address: "Cainta, Rizal", jobPostingId: "job-1", expectedSalary: "15500", availableFrom: "2026-11-10", source: "Walk-in", referredBy: "" };

  it("trims the fields and reads the salary as a number", () => {
    expect(readApplicantForm(form)).toEqual({ input: { fullName: "Mylene Santos", email: "mylene@example.com", mobile: "0917 123 4567", address: "Cainta, Rizal", jobPostingId: "job-1", expectedSalary: 15500, availableFrom: "2026-11-10", source: "Walk-in" } });
  });

  it("asks for a source, and for who referred a Referral", () => {
    expect(readApplicantForm({ ...form, source: "" }).errors).toEqual({ source: "Choose a source." });
    expect(readApplicantForm({ ...form, source: "Careers page" }).errors).toEqual({ source: "Choose a source." });
    expect(readApplicantForm({ ...form, source: "Referral", referredBy: "  " }).errors).toEqual({ referredBy: "Enter who referred them." });
    expect(readApplicantForm({ ...form, source: "Referral", referredBy: " Ana " }).input).toMatchObject({ source: "Referral", referredBy: "Ana" });
    expect(readApplicantForm({ ...form, source: "Facebook", referredBy: "ignored" }).input).not.toHaveProperty("referredBy");
  });

  it("names every missing field", () => {
    expect(readApplicantForm({ fullName: " ", email: "", mobile: "", address: "", jobPostingId: "", expectedSalary: "", availableFrom: "", source: "", referredBy: "" }).errors).toEqual({
      fullName: "Enter the full name.", email: "Enter an email address.", mobile: "Enter a mobile number.", address: "Enter the address.",
      jobPostingId: "Choose a Job Posting.", expectedSalary: "Enter the expected salary.", availableFrom: "Choose the date they can start.", source: "Choose a source.",
    });
  });

  it("rejects a malformed email and a negative salary", () => {
    expect(readApplicantForm({ ...form, email: "mylene" }).errors).toEqual({ email: "Enter a valid email address." });
    expect(readApplicantForm({ ...form, expectedSalary: "-1" }).errors).toEqual({ expectedSalary: "Enter a salary of 0 or more." });
    expect(readApplicantForm({ ...form, expectedSalary: "abc" }).errors).toEqual({ expectedSalary: "Enter a salary of 0 or more." });
  });
});

describe("formatSource", () => {
  it("names a Referral's referrer and leaves other Sources as they are", () => {
    expect(formatSource("Referral", " Paolo Garcia ")).toBe("Referral · Paolo Garcia");
    expect(formatSource("Referral", null)).toBe("Referral");
    expect(formatSource("Careers page", null)).toBe("Careers page");
    expect(formatSource("Unspecified", null)).toBe("Unspecified");
  });
});
