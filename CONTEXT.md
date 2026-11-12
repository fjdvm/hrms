# HRMS

A staff-facing Human Resource Management system for Bren Raphael's. Its UI shell is copied from CREOMS.

## Language

**Staff**:
A person who signs in through the central Portal and works in HRMS. The Portal calls the same person a User.
_Avoid_: User, admin, Employee

**Portal**:
The central sign-in site that Staff sign in through and are sent into HRMS from. It decides who may open HRMS and which of its Modules. Signing out of HRMS signs the Staff member out of the Portal and every other Bren Raphael's system.
_Avoid_: Auth app, login site

**Module**:
A feature area of HRMS that the Portal grants or revokes per Staff member, shown as one tab in the sidebar. Each HRMS page belongs to exactly one Module. The Modules are Dashboard, Attendance, Employee Information, Payroll & ESS, Recruitment and Hiring, and User Management. The Portal and HRMS use the same Module names.
_Avoid_: Permission, feature, section, page

**HR-ATS**:
The company's Applicant Tracking System, which is the Recruitment and Hiring Module of HRMS. It is where Staff author Job Postings and, later, work Applications through the hiring workflow. The Careers site of the e-commerce app reads what HR-ATS publishes.
_Avoid_: ATS app, recruitment app

**Job Posting**:
One open role that Staff author in HR-ATS and Applicants see on the Careers site. It can be started from a Job Template or typed from scratch, and is Draft, Open, Closed or Filled. Staff see the Open status labelled "Published", and publishing a Draft is what makes it Open. Filled means the role was filled by a hire (it becomes Filled when the number of Hired Applications for it reaches its openings; a Closed one stays Closed), and Closed means it ended otherwise (Staff closed it or its deadline passed). Only an Open Job Posting is visible on Careers. HRMS and Careers share one database, so a Job Posting is one record seen by both.
_Avoid_: Job, listing, vacancy

**Applicant**:
A person who applies for a job at Bren Raphael's. An Applicant is a person, not a row in the Applicants list; one Applicant who applies to two Job Postings has two Applications. Unrelated to Staff, even for the same person.
_Avoid_: Candidate, user

**Application**:
One Applicant's candidacy for one Job Posting. An Applicant has at most one Application per Job Posting. Each row of the Applicants tab is an Application, and its profile page is the Application's page, with the Applicant's identity shown inside it. The tab is called "Applicants" because that is HR's word for it.
_Avoid_: Applicant (for the row), submission, candidacy

**Stage**:
Where an Application stands in the hiring workflow: New, Screening, Interview, Offer, Hired or Rejected. The tracker on an Application's page labels New as "Applied". An Applicant who withdraws puts the Application in a Withdrawn state that Staff cannot change; it is shown under All only and is not a Stage Staff can move an Application into. The Careers site shows the same value as the Application's status.
_Avoid_: Status (in the HRMS UI), step

**Offer**:
One written job offer made to one Application, with its own status: Draft, Sent, Accepted or Declined. An Application has at most one Offer. Declining moves the Application to Rejected, so it is a Decided offer; accepting leaves the Application at the Offer Stage until Staff mark it Hired. An Offer is created as a Draft for an Application at the Offer Stage with no Offer yet; a Draft can be edited or deleted, and sending it locks its terms. Its terms are monthly salary, start date, employment type, schedule, probation period and who the person reports to. They are delivered in the offer email and shown identically on the Applicant's Careers page; there is no offer letter file. An Offer's reply is final: Accepted and Declined cannot be changed, and the email they send cannot be edited or cancelled once queued. When Staff record a reply they choose when its email goes out; a reply the Applicant makes on Careers sends its email at once. When the Applicant withdraws the Application, its Offer (Draft, Sent or Accepted) shows as Withdrawn, is not counted as waiting for a reply, and allows no further action; it is listed under the Offers tab's Withdrawn tab only, never under All. A Sent Offer past its reply-by date stays Sent and is flagged overdue; nothing expires automatically, Staff can extend the date, and a reply can still be recorded. The Offers tab lists Offers by their status, whereas the Applicants tab lists Applications by their Stage.
_Avoid_: Job offer (alone), Offer Stage (for the Offer itself)

**Pre-employment Document**:
One of the seven documents an Offer's checklist tracks before Staff may mark the person Hired: résumé, valid ID, NBI clearance, health certificate, SSS, PhilHealth, and Pag-IBIG MID and TIN. Each is Submitted, Requested or Not requested. One the Applicant already sent with the Application starts as Submitted, so Staff can only request the missing ones. An upload counts as Submitted at once, with no Staff approval; Staff can request it again, which resets it to Requested, and the new upload replaces the old file. Not the same as a Required Document, which is what a Job Posting asks for at application time.
_Avoid_: Requirement, onboarding document

**Employee record**:
The record of a person who works for Bren Raphael's, created when Staff mark an Offer's Application as Hired. It carries over the Applicant's details, the Offer's terms and the Pre-employment Documents (their Digital 201 folder), and starts as Onboarding. It is created together with the move to Hired, never separately. Unrelated to Staff, even for the same person.
_Avoid_: Employee (for the record), Staff

**Source**:
Where an Application came from: Careers page, Facebook, JobStreet, Walk-in or Referral. Every Application the Applicant submits on the Careers site is "Careers page", even if they first saw the job elsewhere, because the Careers site does not ask. Staff choose the Source when they add an Applicant by hand, and for a Referral they also record who referred the Applicant as free text, not linked to a Staff member. An Application added by hand before Sources were recorded has no Source and is shown as "Unspecified".
_Avoid_: Channel, origin

**Required Document**:
A document an Applicant must upload to apply for a Job Posting. Staff tick from Resume or CV, Valid government ID and Health certificate, and can add their own, such as "NBI clearance". It is always a document; other hiring criteria are not Required Documents.
_Avoid_: Application requirement, attachment

**Document**:
A file an Applicant attached to their profile and sent with an Application, such as a resume or a government ID. Staff open it from the Application's page. It is the file itself, whereas a Required Document is the requirement it answers.
_Avoid_: Attachment, upload, Required Document (for the file)

**Job Template**:
A saved, reusable role definition that Staff start Job Postings from. It exists only because Staff explicitly saved it; typing a Job Posting from scratch never creates one unless Staff choose "Save as template".
_Avoid_: Saved job, preset

**Attendance**:
The Module for employee attendance. Biometrics is not a separate Module and is not part of its name.
_Avoid_: Attendance Biometrics, Biometrics

**Widget**:
A summary block on the Dashboard that belongs to exactly one Module and is shown only to Staff who hold that Module. Until its Module has data, a Widget shows "Nothing to show yet". The Dashboard has no Widget of its own.
_Avoid_: Tile, panel

**Key Summary Card**:
A kind of Widget that shows one headline figure at the top of the Dashboard, with an optional line of detail beneath it. The Key Summary Cards are Open jobs, Applicants, Interviews this week, Offer acceptance, Average time to hire, Total Employee, and Attendance Rate. The hiring cards (owned by Recruitment and Hiring) sit in a row of their own above the rest. The owning Module of Attendance Rate may change if Attendance is replaced.
_Avoid_: KPI, stat tile, Open Positions (replaced by Open jobs)

**Open jobs**:
A Key Summary Card, owned by Recruitment and Hiring, that shows how many Job Postings are Open right now, with the openings they list in total and the locations they cover. "Jobs" is only the card's label; the thing counted is the Open Job Posting. It is read from the shared database and is not affected by any date range.

**Applicants**:
A Key Summary Card, owned by Recruitment and Hiring, that shows how many Applications were received in the Dashboard Range, including HR-added, rejected and withdrawn ones. Its detail line is the comparison with the Previous period. "Applicants" is only the card's label; the thing counted is the Application.

**Interviews this week**:
A Key Summary Card, owned by Recruitment and Hiring, that shows how many Interviews start in the current Monday-to-Sunday week (Manila time), finished ones included, with how many start today. It shows 0, not "Nothing to show yet", when there are none. It is not affected by the Dashboard Range and makes no comparison.

**Dropped Interview**:
An Interview with no result whose Application has left the Interview Stage (Rejected, Withdrawn, or moved on). It is treated as not taking place: off the list and Calendar and ignored by conflicts, but kept on the Application profile's Interviews table, where its status reads "Dropped". Rescheduling and recording a result are no longer offered.

**Decided offer**:
An Application that reached the Offer Stage and then left it with an answer: reached Hired (accepted) or Rejected (not accepted). It is dated by when it was decided, not when the offer was made. An offer still waiting is not a decided offer. An Applicant who withdraws after an offer has no decision date to read, so is not counted.

**Offer acceptance**:
A Key Summary Card, owned by Recruitment and Hiring, that shows accepted decided offers as a whole percent of the decided offers whose decision date is in the Dashboard Range, with "X of Y offers accepted" beneath. Its comparison with the Previous period is in percentage points. It shows "Nothing to show yet", never 0%, when no offer was decided.

**Average time to hire**:
A Key Summary Card, owned by Recruitment and Hiring, that shows the mean number of whole days (Manila dates) from an Application being received to being Hired, over the Applications Hired in the Dashboard Range. Its comparison with the Previous period says how many days faster or slower. It shows "Nothing to show yet", never 0 days, when nobody was Hired.

**Dashboard Range**:
The period the range-dependent Key Summary Cards cover, chosen from the presets This month (default), Last month, Last 30 days, Last 90 days and Year to date, or as a Custom range of two dates no later than today and at most a year apart. It is kept in the URL, anything unknown or invalid means This month, and every date and boundary is in Manila time. This month and Year to date run from the start of the month or year to today; Last 30 and 90 days include today. Only Staff who hold Recruitment and Hiring see the selector.
_Avoid_: Date filter, period (for the range itself)

**Previous period**:
The period a Dashboard Range is compared with. This month is compared with the same days of last month (held at the end of a shorter month), Last month with the month before it, Last 30 or 90 days with the same number of days just before, Year to date with the same days of last year, and a Custom range with the period of the same length just before it. A comparison is left out when either period has no data.

**Detail Widget**:
A kind of Widget that shows more than one headline figure, such as a chart or a list, on the Dashboard beside or below the Key Summary Cards. The Detail Widgets are Hiring pipeline, Needs attention, Applicants by job, Where applicants come from, Upcoming interviews, Headcount Trend, Department Distribution, Recent Activity, and Upcoming Events. The hiring ones are owned by Recruitment and Hiring. Where a Detail Widget has a headline sentence, it is computed from the data and falls back to a neutral line when there is none. In the code, `Widget` on its own is not used; the Key Summary Cards and the Detail Widgets are separate types.
_Avoid_: Panel, tile

**Headcount Trend**:
A kind of Widget, owned by Employee Information, that charts how the Total Employee figure changed over time.

**Department Distribution**:
A kind of Widget, owned by Employee Information, that shows how the company's employees split across departments.

**Recent Activity**:
A kind of Widget, owned by Employee Information, that lists the latest employee-record events such as hires, transfers and status changes. It does not draw on other Modules.

**Upcoming Events**:
A kind of Widget, owned by Attendance, that lists what is coming up such as approved leave and holidays. It does not draw on other Modules.

**Hiring pipeline**:
A Detail Widget, owned by Recruitment and Hiring, that shows how many Applications received in the Dashboard Range have ever reached each Stage (Applied, Screening, Interview, Offer, Hired), each as a percent of all Applications received. Rejected and Withdrawn are not bars. Its headline names how many applicants it takes to get one hire and the Stage where most drop off.

**Needs attention**:
A Detail Widget, owned by Recruitment and Hiring, that lists what Staff should act on now, not affected by the Dashboard Range: Applications to review (at New), Interviews to schedule (at Screening with no interview booked), Results to record (interviews that ended with no result), Offers past reply date (Sent Offers whose reply-by date, in Manila, has passed) and Missing documents (Sent or Accepted Offers with a Pre-employment Document Staff requested that is not yet Submitted, counted per Offer). An Offer on a Withdrawn Application, and any Draft or Declined Offer, is never counted in either. Offer acceptance keeps its own definition.

**Applicants by job**:
A Detail Widget, owned by Recruitment and Hiring, that ranks the five Job Postings with the most Applications received in the Dashboard Range, each with its count and its percent of all Applications received in the range. Job Postings that are no longer Open are included. Its headline names the Job Posting with the most Applications.

**Upcoming interviews**:
A Detail Widget, owned by Recruitment and Hiring, that lists the next five Interviews still to start in the current Monday-to-Sunday week (Manila time), each with the applicant, the Job Posting and the Interview type. Finished Interviews are left out, and the Dashboard Range does not affect it. Its headline says how many start today and how many more this week. Unrelated to Upcoming Events, which lists leave and holidays.

**Where applicants come from**:
A Detail Widget, owned by Recruitment and Hiring, that shows each Source's share of the Applications received in the Dashboard Range and its hire rate, the Applications from that Source that have reached Hired as a percent of those from it. "Unspecified" appears as a row only when it has Applications and never wins a headline. Its headline names the Source with the most Applications and the Source with the highest hire rate, falling back to "Careers page brings the most applicants" when no Application was received.

## UI design reference

The Figma file [Bren Raphael's CRM - Orders Prototype](https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=0-1&p=f&t=ZlW5bZYq2Dp1w315-0) is the reference for all UI design in HRMS. Always check it before building or changing any UI.
