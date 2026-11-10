# Deploying HRMS on Vercel

HRMS runs on Vercel at `https://hrms.buildwrite.me` and signs in through the Azure Portal
(`https://portal.buildwrite.me`) and the API gateway (`https://api.buildwrite.me`).

1. In the owner's second Vercel account (`judenitram08-3882`), import `fjdvm/hrms` as a new project
   (framework Next.js, defaults otherwise).
2. **Before the first build**, add every variable in `.env.production.example` for the Production
   environment. `NEXT_PUBLIC_HRMS_URL` is baked in at build time.
3. Do **not** set `HRMS_DEV_BYPASS`; the app throws on a Vercel deployment if it is set.
4. `vercel.json` registers one Cron job: `/api/cron/job-postings`, daily at `0 0 * * *` (00:00 UTC),
   which closes Job Postings past their deadline. Vercel sends `CRON_SECRET` as a bearer token.
5. Add the domain `hrms.buildwrite.me` to the project (CNAME at Namecheap) once deployed. The Portal
   already has `https://hrms.buildwrite.me/api/portal/callback` registered.
