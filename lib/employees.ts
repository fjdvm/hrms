import { encryptEmployeeId, decryptEmployeeId } from "./employee-encryption";
import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import { DOCUMENT_COUNT, PRE_EMPLOYMENT_DOCUMENTS } from "./offer-documents";
import { gatewayDocumentFiles, type DocumentFiles } from "./document-files";

export const EMPTY_EMPLOYEE_SECTION = "Not provided yet";
// The one place that names the Portal roles allowed to see unmasked IDs and pay, and to act in Onboarding.
const MANAGER_ROLES = ["Super Admin", "HRMS Manager"] as const;
export const SENSITIVE_EMPLOYEE_ROLES = MANAGER_ROLES;
export const ONBOARDING_ACTING_ROLES = MANAGER_ROLES;
export const canActInOnboarding = (role: string) => ONBOARDING_ACTING_ROLES.some(r => r === role);
export type AccountState = "Not requested" | "Requested" | "Account created" | "No account needed";
export type OnboardingAction = "request" | "no-account-needed" | "undo-no-account-needed" | "remind" | "cancel";
export type OnboardingFilters = { state?: AccountState; search?: string };
export type OnboardingRow = {
  id: number; employeeNumber: string; name: string; initials: string; position: string; branch: string; startDate: string;
  workEmail: string; accountState: AccountState; requestReference: string | null; requestStatus: string | null;
  /** The start date has passed (Manila) and there is still no account or "No account needed". */
  overdue: boolean; /** Set when the account exists but the start date has not arrived: the date it becomes Active. */
  becomesActiveOn: string | null; actions: OnboardingAction[];
};
const DOMAIN = "brenraphaels.ph";
const emailPart = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** firstname.lastname@brenraphaels.ph; a single name gives just that name. */
export function defaultWorkEmail(fullName: string) {
  const words = fullName.split(/\s+/u).map(emailPart).filter(Boolean);
  const local = words.length > 1 ? `${words[0]}.${words[words.length - 1]}` : words[0] ?? "employee";
  return `${local}@${DOMAIN}`;
}
export const canSeeEmployeeSensitiveFields = (role: string) => SENSITIVE_EMPLOYEE_ROLES.some(r => r === role);
export type EmployeeStatus = "Onboarding" | "Active";
export type EmployeeListFilters = { status?: EmployeeStatus; branch?: string; search?: string };
export type EmployeeListRow = {
  id: number; employeeNumber: string; name: string; initials: string; email: string; position: string; department: string | null;
  branch: string; startDate: string; documentsSubmitted: number; documentsTotal: number; documentsMissing: number;
  documentsLabel: string; status: EmployeeStatus;
};
const initialsOf = (name: string) => name.split(/\s+/u).filter(Boolean).slice(0, 2).map(w => Array.from(w)[0].toUpperCase()).join("");
const documentsLabel = (submitted: number, total: number) => submitted >= total ? `${total}/${total} complete` : `${submitted}/${total} · ${total - submitted} missing`;
// Spreadsheet apps run a cell that starts with these as a formula; prefix it so exported names and positions stay text.
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
export class EmployeeError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found") {
    super(`Employee: ${reason}`);
  }
}
type EmployeeRow = {
  id: number; employeeNumber: string; name: string; email: string; birthday: string | null; sex: string | null;
  civilStatus: string | null; mobile: string | null; homeAddress: string | null;
  position: string; department: string | null; branch: string; startDate: string; status: string;
  probationEndDate: string | null; offerId: number; applicationId: number; employmentType: string;
  schedule: string; reportsTo: string; monthlyPay: number; signed: boolean;
};
export type GovernmentIds = { sss: string | null; philhealth: string | null; pagibigMid: string | null; tin: string | null };
const ID_FIELDS = ["sss", "philhealth", "pagibigMid", "tin"] as const;
const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2147483647;
const maskId = (value: string) => value.length > 3 ? value.slice(0, 2) + value.slice(2, -1).replace(/[^ -]/gu, "•") + value.slice(-1) : "•".repeat(value.length);
type StoredDocument = { type: string; source: string; fileId: string | null; fileName: string | null; uploadedAt: string | null; validUntil: string | null };

const SECTION_FIELDS: Record<string, Record<string,string>> = {
  personal: { name: 'full_name',email: 'email',birthday: 'birthday',sex: 'sex',civilStatus: 'civil_status',mobile: 'mobile',homeAddress: 'home_address' },
  employment: { position: 'position',department: 'department',branch: 'branch',employmentType: 'employment_type',startDate: 'start_date',probationEndDate: 'probation_end_date',reportsTo: 'reports_to',schedule: 'schedule' },
  emergencyContact: { name: 'name',relationship: 'relationship',mobile: 'mobile' },
  contract: { monthlyPay: 'monthly_salary' },
};
export type EmployeeSection = 'personal' | 'employment' | 'emergencyContact' | 'contract';
export type EmployeeAudit = { id: string; actorId: string; actorName: string; kind: string; field: string; oldValue: unknown; newValue: unknown; occurredAt: string };
export type EmployeeHistory = Omit<EmployeeAudit,'actorId'> & { effectiveDate: string };
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
async function requireEmployee(id: number, db: Database) {
  if (!validId(id)) throw new EmployeeError('validation');
  if (!(await db.query('SELECT id FROM public.hrms_employees WHERE id=$1',[id])).rows.length) throw new EmployeeError('not-found');
}

/** Session-scoped Employee Information boundary. Every operation validates the Module with the Portal. */
export function employeesFor(sessionHandle: string | undefined, db: Database = database,
  files: DocumentFiles = gatewayDocumentFiles(), now: () => Date = () => new Date()) {
  async function authorise(module: "Employee Information" | "Employee Onboarding" = "Employee Information") {
    const access = await accessFor(sessionHandle).check(module);
    if (access.decision !== "allowed") throw new EmployeeError(access.decision);
    return access.staff;
  }
  async function readList({ status, branch, search }: EmployeeListFilters) {
    await authorise();
    if ((status !== undefined && status !== "Onboarding" && status !== "Active") ||
      (branch !== undefined && (typeof branch !== "string" || branch.length > 100)) ||
      (search !== undefined && (typeof search !== "string" || search.length > 100))) throw new EmployeeError("validation");
    const term = search?.trim().replace(/[\\%_]/g, "\\$&");
    // Counts and summary describe the Branch and search narrowing, so the tabs always add up to All.
    const { rows } = await db.query<Omit<EmployeeListRow, "initials" | "documentsTotal" | "documentsMissing" | "documentsLabel">>(`
      SELECT e.id, e.employee_number AS "employeeNumber", e.full_name AS name, e.email, e.position, e.department, e.branch,
        e.start_date::text AS "startDate", e.status,
        (SELECT count(*)::int FROM public.hrms_employee_documents d WHERE d.employee_id = e.id
          AND (d.file_id IS NOT NULL OR (d.file_name IS NOT NULL AND d.uploaded_at IS NOT NULL))) AS "documentsSubmitted"
      FROM public.hrms_employees e
      WHERE ($1::text IS NULL OR e.branch = $1)
        AND ($2::text IS NULL OR e.full_name ILIKE '%' || $2 || '%' OR e.employee_number ILIKE '%' || $2 || '%')
      ORDER BY e.employee_number`, [branch || null, term || null]);
    const all = rows.map(r => ({ ...r, initials: initialsOf(r.name), documentsTotal: DOCUMENT_COUNT,
      documentsMissing: DOCUMENT_COUNT - r.documentsSubmitted, documentsLabel: documentsLabel(r.documentsSubmitted, DOCUMENT_COUNT) }));
    const { rows: branches } = await db.query<{ branch: string }>(`SELECT DISTINCT branch FROM public.hrms_employees ORDER BY branch`);
    return {
      rows: status ? all.filter(r => r.status === status) : all,
      counts: { all: all.length, active: all.filter(r => r.status === "Active").length, onboarding: all.filter(r => r.status === "Onboarding").length },
      summary: { employees: all.length, onboarding: all.filter(r => r.status === "Onboarding").length, missingDocuments: all.filter(r => r.documentsMissing > 0).length },
      branches: branches.map(b => b.branch),
    };
  }
  async function readOnboarding({ state, search }: OnboardingFilters) {
    const staff = await authorise("Employee Onboarding");
    const states: string[] = ["Not requested", "Requested", "Account created", "No account needed"];
    if ((state !== undefined && !states.includes(state)) || (search !== undefined && (typeof search !== "string" || search.length > 100))) throw new EmployeeError("validation");
    const term = search?.trim().replace(/[\\%_]/g, "\\$&");
    const today = now().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    // The active request (not cancelled or declined) decides the state; otherwise the "No account needed" decision; otherwise none.
    const { rows } = await db.query<{ id: number; employeeNumber: string; name: string; position: string; branch: string; startDate: string;
      noAccountNeeded: boolean; requestStatus: string | null; requestReference: string | null; requestEmail: string | null }>(`
      SELECT e.id, e.employee_number AS "employeeNumber", e.full_name AS name, e.position, e.branch, e.start_date::text AS "startDate",
        e.no_account_needed_at IS NOT NULL AS "noAccountNeeded", r.status AS "requestStatus", r.reference AS "requestReference", r.work_email AS "requestEmail"
      FROM public.hrms_employees e
      LEFT JOIN LATERAL (SELECT status, reference, work_email FROM public.hrms_account_requests q WHERE q.employee_id = e.id
        ORDER BY (q.status IN ('requested','seen','account_created','login_sent')) DESC, q.id DESC LIMIT 1) r ON true
      WHERE e.status = 'Onboarding'
        AND ($1::text IS NULL OR e.full_name ILIKE '%' || $1 || '%' OR e.employee_number ILIKE '%' || $1 || '%')
      ORDER BY e.start_date, e.employee_number`, [term || null]);
    const acting = canActInOnboarding(staff.role);
    const all = rows.map((r): OnboardingRow => {
      const active = r.requestStatus && ["requested", "seen", "account_created", "login_sent"].includes(r.requestStatus);
      const accountState: AccountState = active ? (r.requestStatus === "requested" || r.requestStatus === "seen" ? "Requested" : "Account created")
        : r.noAccountNeeded ? "No account needed" : "Not requested";
      const actions: OnboardingAction[] = !acting ? [] : accountState === "Not requested" ? ["request", "no-account-needed"]
        : accountState === "Requested" ? ["remind", "cancel"] : accountState === "No account needed" ? ["undo-no-account-needed"] : [];
      return { id: r.id, employeeNumber: r.employeeNumber, name: r.name, initials: initialsOf(r.name), position: r.position, branch: r.branch,
        startDate: r.startDate, workEmail: active ? r.requestEmail! : defaultWorkEmail(r.name), accountState,
        requestReference: r.requestReference, requestStatus: r.requestStatus,
        overdue: r.startDate < today && (accountState === "Not requested" || accountState === "Requested"),
        becomesActiveOn: accountState === "Account created" && r.startDate > today ? r.startDate : null, actions };
    });
    const count = (s: AccountState) => all.filter(r => r.accountState === s).length;
    return {
      rows: state ? all.filter(r => r.accountState === state) : all,
      counts: { all: all.length, needsAccount: count("Not requested"), requested: count("Requested"),
        accountCreated: count("Account created"), noAccountNeeded: count("No account needed") },
      summary: { needsAccount: count("Not requested"), requested: count("Requested"), accountCreated: count("Account created") },
      canAct: acting,
    };
  }
  return {
    /** Onboarding: every Onboarding Employee record with its account state. Active records never appear. Read-only unless the role may act. */
    onboarding: (filters: OnboardingFilters = {}) => readOnboarding(filters),
    /** The Employee list: rows, tab counts, summary and Branch options. Never includes government IDs or pay. */
    list: (filters: EmployeeListFilters = {}) => readList(filters),
    /** CSV of the current list. Columns are fixed and exclude government IDs and pay for every role. */
    async exportCsv(filters: EmployeeListFilters = {}): Promise<string> {
      const { rows } = await readList(filters);
      const records = [
        ["Employee ID", "Name", "Email", "Position", "Department", "Branch", "Start date", "Documents", "Status"],
        ...rows.map(r => [r.employeeNumber, r.name, r.email, r.position, r.department ?? "", r.branch, r.startDate, r.documentsLabel, r.status]),
      ];
      return records.map(record => record.map(csvCell).join(",")).join("\r\n") + "\r\n";
    },
    /** Internal write seam for Employee editors; encryption and edit auditing are inseparable. Replaces all four fields. */
    async replaceGovernmentIds(id: number, input: Partial<GovernmentIds>) {
      const staff = await authorise();
      if (!canSeeEmployeeSensitiveFields(staff.role)) throw new EmployeeError("denied");
      if (!validId(id) || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(f => !ID_FIELDS.includes(f as typeof ID_FIELDS[number])) ||
        ID_FIELDS.some(f => input[f] != null && (typeof input[f] !== "string" || !input[f]!.trim() || input[f]!.length > 100))) throw new EmployeeError("validation");
      const values = ID_FIELDS.map(f => input[f] == null ? null : encryptEmployeeId(input[f]!.trim(), id, f));
      const { rows } = await db.query<{ employee_id: number }>(`WITH actor AS MATERIALIZED (
        SELECT set_config('hrms.actor_id',$6,true),set_config('hrms.actor_name',$7,true)
      ) INSERT INTO public.hrms_employee_government_ids (employee_id,sss,philhealth,pagibig_mid,tin)
        SELECT e.id,$2,$3,$4,$5 FROM public.hrms_employees e CROSS JOIN actor WHERE e.id = $1
        ON CONFLICT (employee_id) DO UPDATE SET sss = EXCLUDED.sss, philhealth = EXCLUDED.philhealth,
          pagibig_mid = EXCLUDED.pagibig_mid, tin = EXCLUDED.tin RETURNING employee_id`,
        [id,...values,staff.id ?? staff.username,staff.name]);
      if (!rows[0]) throw new EmployeeError("not-found");
    },
    async editSection(id: number, section: EmployeeSection, input: Record<string, unknown>, effectiveDate?: string) {
      const staff = await authorise();
      if (!validId(id) || !Object.hasOwn(SECTION_FIELDS, section) || !input || typeof input !== 'object' || Array.isArray(input)) throw new EmployeeError('validation');
      if (section === 'contract' && !canSeeEmployeeSensitiveFields(staff.role)) throw new EmployeeError('denied');
      const fields = SECTION_FIELDS[section];
      const entries = Object.entries(input);
      if (!entries.length || entries.some(([key]) => !Object.hasOwn(fields,key))) throw new EmployeeError('validation');
      const today = now().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      if (effectiveDate !== undefined && !validDate(effectiveDate)) throw new EmployeeError('validation');
      for (const [key,value] of entries) {
        if (key === 'monthlyPay') {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) throw new EmployeeError('validation');
        } else if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 1000)) throw new EmployeeError('validation');
        if (['name','email','position','branch','startDate','employmentType','schedule','reportsTo'].includes(key) && (typeof value !== 'string' || !value.trim())) throw new EmployeeError('validation');
        if (['birthday','startDate','probationEndDate'].includes(key) && value !== null && (!validDate(value) || (key === 'birthday' && (value as string) > today))) throw new EmployeeError('validation');
        if (key === 'mobile' && value !== null && !/^(09|\+639)\d{9}$/.test(String(value))) throw new EmployeeError('validation');
        if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) throw new EmployeeError('validation');
      }
      const values: unknown[] = [id,staff.id ?? staff.username,staff.name,effectiveDate ?? today];
      const columns = entries.map(([key,value]) => {
        values.push(typeof value === 'string' ? value.trim() : value);
        return { column: fields[key], parameter: `$${values.length}` };
      });
      const actor = `WITH actor AS MATERIALIZED (SELECT set_config('hrms.actor_id',$2,true),set_config('hrms.actor_name',$3,true),set_config('hrms.effective_date',$4,true))`;
      const sql = section === 'emergencyContact'
        ? `${actor} INSERT INTO public.hrms_employee_emergency_contacts(employee_id,${columns.map(c => c.column).join(',')})
           SELECT e.id,${columns.map(c => c.parameter).join(',')} FROM public.hrms_employees e CROSS JOIN actor WHERE e.id=$1
           ON CONFLICT(employee_id) DO UPDATE SET ${columns.map(c => `${c.column}=EXCLUDED.${c.column}`).join(',')} RETURNING employee_id`
        : `${actor} UPDATE public.hrms_employees SET ${columns.map(c => `${c.column}=${c.parameter}`).join(',')} FROM actor WHERE id=$1 RETURNING id`;
      try {
        if (!(await db.query(sql,values)).rows.length) throw new EmployeeError('not-found');
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23514') throw new EmployeeError('validation');
        throw error;
      }
    },
    async activity(id: number) {
      await authorise();
      await requireEmployee(id, db);
      const { rows } = await db.query<EmployeeAudit>(`SELECT id::text,actor_id AS "actorId",actor_name AS "actorName",kind,field,
        CASE WHEN field IN ('sss','philhealth','pagibigMid','tin','monthlyPay') THEN to_jsonb('[redacted]'::text) ELSE old_value END AS "oldValue",
        CASE WHEN field IN ('sss','philhealth','pagibigMid','tin','monthlyPay') THEN to_jsonb('[redacted]'::text) ELSE new_value END AS "newValue",
        occurred_at::text AS "occurredAt" FROM public.hrms_employee_audit WHERE employee_id=$1 ORDER BY occurred_at DESC,id DESC`,[id]);
      return rows;
    },
    async history(id: number) {
      const staff = await authorise();
      await requireEmployee(id, db);
      const { rows } = await db.query<EmployeeHistory>(`SELECT id::text,actor_name AS "actorName",kind,field,old_value AS "oldValue",new_value AS "newValue",
        effective_date::text AS "effectiveDate",occurred_at::text AS "occurredAt" FROM public.hrms_employee_history WHERE employee_id=$1 ORDER BY occurred_at DESC,id DESC`,[id]);
      if (canSeeEmployeeSensitiveFields(staff.role) && rows.length) {
        await db.query(`INSERT INTO public.hrms_employee_audit(employee_id,actor_id,actor_name,kind,field)
          VALUES($1,$2,$3,'reveal','monthlyPay')`,[id,staff.id ?? staff.username,staff.name]);
      }
      return rows.map(row => canSeeEmployeeSensitiveFields(staff.role) ? row : { ...row,
        oldValue: row.field === 'monthlyPay' ? '[redacted]' : row.oldValue,
        newValue: row.field === 'monthlyPay' ? '[redacted]' : row.kind === 'Hired' ? Object.fromEntries(Object.entries(row.newValue as Record<string,unknown>).filter(([key]) => key !== 'monthlyPay')) : row.newValue });
    },
    async read(id: number) {
      const staff = await authorise();
      if (!validId(id)) throw new EmployeeError("validation");
      const { rows } = await db.query<EmployeeRow>(`SELECT e.id, e.employee_number AS "employeeNumber", e.full_name AS name,
        e.email, e.birthday::text, e.sex, e.civil_status AS "civilStatus", e.mobile, e.home_address AS "homeAddress",
        e.position, e.department, e.branch, e.start_date::text AS "startDate", e.status,
        e.probation_end_date::text AS "probationEndDate", e.offer_id AS "offerId", e.application_id AS "applicationId",
        e.employment_type AS "employmentType", e.schedule, e.reports_to AS "reportsTo", e.monthly_salary AS "monthlyPay",
        o.status = 'Accepted' AS signed FROM public.hrms_employees e JOIN public.hrms_offers o ON o.id = e.offer_id WHERE e.id = $1`, [id]);
      const e = rows[0];
      if (!e) throw new EmployeeError("not-found");
      const { rows: contacts } = await db.query<{ name: string | null; relationship: string | null; mobile: string | null }>(
        `SELECT name, relationship, mobile FROM public.hrms_employee_emergency_contacts WHERE employee_id = $1`, [id]);
      const { rows: documents } = await db.query<StoredDocument>(`SELECT document_type AS type, source, file_id AS "fileId", file_name AS "fileName",
        COALESCE(uploaded_at, (SELECT od.submitted_at FROM public.hrms_offer_documents od
          WHERE od.offer_id = $2 AND od.document_type = hrms_employee_documents.document_type
            AND od.file_id = hrms_employee_documents.file_id AND hrms_employee_documents.source = 'upload'))::text AS "uploadedAt",
        valid_until::text AS "validUntil" FROM public.hrms_employee_documents WHERE employee_id = $1`, [id,e.offerId]);
      // At hire, Application-source links retain the applicant_documents id, while upload links retain the gateway file id.
      // Resolve only files belonging to this Application's Applicant, without requiring the Applications Module.
      if (documents.some(d => d.source === "application" && d.fileId)) {
        const { rows: applicationFiles } = await db.query<{ id: string; fileId: string | null; uploadedAt: string | null }>(`
          SELECT d.id::text, d.file_id AS "fileId", d.created_at::text AS "uploadedAt"
          FROM public.applicant_documents d JOIN public.applications a ON a.applicant_id = d.applicant_id
          WHERE a.id = $1 AND d.id::text = ANY($2::text[])`,
          [e.applicationId, documents.filter(d => d.source === "application").map(d => d.fileId)]);
        for (const document of documents.filter(d => d.source === "application")) {
          const file = applicationFiles.find(f => f.id === document.fileId);
          document.fileId = file?.fileId ?? null;
          document.uploadedAt ??= file?.uploadedAt ?? null;
        }
      }
      const { rows: storedIds } = await db.query<GovernmentIds>(`SELECT sss,philhealth,pagibig_mid AS "pagibigMid",tin
        FROM public.hrms_employee_government_ids WHERE employee_id = $1`, [id]);
      const ids = storedIds[0];
      const sensitive = canSeeEmployeeSensitiveFields(staff.role);
      const governmentIds: GovernmentIds | typeof EMPTY_EMPLOYEE_SECTION = ids && Object.values(ids).some(Boolean)
        ? Object.fromEntries(ID_FIELDS.map(field => {
          const value = ids[field] ? decryptEmployeeId(ids[field], id, field) : null;
          return [field, value && !sensitive ? maskId(value) : value];
        })) as GovernmentIds : EMPTY_EMPLOYEE_SECTION;
      // Fail closed: no disclosed response is returned if the durable audit write fails.
      if (sensitive) await db.query(`INSERT INTO public.hrms_employee_audit (employee_id,actor_id,actor_name,kind,field)
        SELECT $1,$2,$3,'reveal',field FROM unnest($4::text[]) AS field`,
        [id,staff.id ?? staff.username,staff.name,[...ID_FIELDS.filter(f => ids?.[f]),"monthlyPay"]]);
      const today = now().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      let age: number | null = null;
      if (e.birthday) age = Number(today.slice(0, 4)) - Number(e.birthday.slice(0, 4)) - (today.slice(5) < e.birthday.slice(5) ? 1 : 0);
      return {
        id: e.id, employeeNumber: e.employeeNumber,
        personal: { name: e.name, email: e.email, birthday: e.birthday, age, sex: e.sex, civilStatus: e.civilStatus, mobile: e.mobile, homeAddress: e.homeAddress },
        employment: { position: e.position, department: e.department, branch: e.branch, startDate: e.startDate, status: e.status,
          probationEndDate: e.probationEndDate, reportsTo: e.reportsTo, schedule: e.schedule,
          hiredFrom: { offerId: e.offerId, applicationId: e.applicationId, offerUrl: `/offers/${e.offerId}`, applicationUrl: `/applicants/${e.applicationId}` } },
        governmentIds,
        emergencyContact: contacts[0] && Object.values(contacts[0]).some(Boolean) ? contacts[0] : EMPTY_EMPLOYEE_SECTION,
        documents: await Promise.all(PRE_EMPLOYMENT_DOCUMENTS.map(async document => {
          const stored = documents.find(d => d.type === document.type);
          return { ...document, fileName: stored?.fileName ?? null, uploadedAt: stored?.uploadedAt ?? null,
            validUntil: stored?.validUntil ?? null, viewUrl: stored?.fileId ? await files.viewUrl(stored.fileId) : null,
            status: stored && (stored.fileId || (stored.fileName && stored.uploadedAt)) ? "Submitted" : EMPTY_EMPLOYEE_SECTION };
        })),
        contract: { offerLetterSigned: e.signed, contractType: e.employmentType,
          ...(canSeeEmployeeSensitiveFields(staff.role) ? { monthlyPay: e.monthlyPay } : {}) },
      };
    },
  };
}

export type EmployeeDetail = Awaited<ReturnType<ReturnType<typeof employeesFor>["read"]>>;
