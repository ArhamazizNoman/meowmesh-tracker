# MeowMesh Team Tracker — Setup Guide

This gets your tracker live on a free `github.io` web link, with a free database so you and your team all see the same reports. **Total cost: $0.** No coding needed — just copying and pasting.

You'll do three things:
1. Create the free database (Supabase)
2. Paste two values into the app file
3. Put the app on GitHub so it goes live

Set aside about 20 minutes. Take it one step at a time.

---

## Part 1 — Create the database (Supabase)

1. Go to **supabase.com** and click **Start your project**. Sign up (free — you can use your Google account).
2. Click **New project**.
   - Give it a name like `meowmesh-tracker`
   - Set a database password (save it somewhere — you won't need it for this app, but keep it)
   - Pick the region closest to Bangladesh (e.g. Singapore / South Asia)
   - Click **Create new project** and wait ~1 minute for it to finish setting up.
3. On the left sidebar, click **SQL Editor** → **New query**.
4. Open the file **`supabase_setup.sql`** (included in this package), copy everything in it, paste it into the query box, and click **Run**. You should see "Success". This creates the table that stores the reports.
5. Now get your two connection values. On the left sidebar click **Project Settings** (gear icon) → **API**. You'll see:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **Project API keys → `anon` `public`** — a long string of characters
   - Keep this tab open; you'll copy these in Part 2.

---

## Part 2 — Connect the app

1. Open the file **`index.html`** in any text editor (Notepad works, or Notepad++ / VS Code).
2. Near the top, find these two lines:

   ```
   window.SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
   window.SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";
   ```

3. Replace the placeholder text (keep the quotes!) with your two values from Supabase:

   ```
   window.SUPABASE_URL = "https://abcdefgh.supabase.co";
   window.SUPABASE_ANON_KEY = "your-long-anon-key-here";
   ```

4. Save the file. That's it — the app is now wired to your database.

> Tip: you can double-click `index.html` to open it in your browser and test it right now, before uploading. Submit a test report as "Marketer", then check the "Owner" view — you should see it appear.

---

## Part 3 — Put it live on GitHub Pages

1. Go to **github.com** and sign up / log in (free).
2. Click the **+** (top right) → **New repository**.
   - Name it `meowmesh-tracker`
   - Set it to **Public**
   - Click **Create repository**
3. On the new repo page, click **uploading an existing file** (the link in the middle).
4. Drag in your edited **`index.html`** file. (You only need `index.html` — not the SQL or this README.) Then click **Commit changes**.
5. Go to the repo's **Settings** tab → **Pages** (left sidebar).
6. Under **Branch**, choose **main** and **/ (root)**, then click **Save**.
7. Wait 1–2 minutes. Refresh the page — GitHub will show a link like:

   ```
   https://YOUR-USERNAME.github.io/meowmesh-tracker/
   ```

That's your live tracker. Share that link with your two employees. They open it, pick their role, and submit daily — you open the same link, pick **Owner**, and see everything.

---

## Day-to-day use

- **Marketer / Operations:** open the link, pick your role, tick off tasks, add notes/blockers, hit submit. Re-submitting on the same day just updates that day's entry.
- **You (Owner):** open the link, pick Owner, and review. Use the filter tabs and Refresh button.

---

## Good to know

- **Cost:** Supabase's free tier and GitHub Pages are both free at your scale and won't expire. A 2-person team won't come close to any limit.
- **Privacy:** this simple setup lets anyone who has the link read and write reports. That's fine for internal task tracking, but don't store anything sensitive. If you later want a password or per-person login, that can be added — just ask.
- **Changing tasks / adding a person:** the task checklists live inside `index.html` (in the `TASKS` section). Editing them is a small code change — send me what you want and I'll update the file for you.
- **Updating the live app:** to change anything later, edit `index.html`, then in your GitHub repo click the file → pencil icon → paste the new version → Commit. The live link updates automatically.
