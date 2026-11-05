# Cadet HF-1 test site

A simulated HF SDR transceiver for CCS 4-Star cadets, packaged as its own Cloudflare Worker so a wider group can test it. It follows the same pattern as Talk It Down.

- **`public/index.html`**: the radio. The live microphone works here, because the page is served from your own HTTPS domain.
- **`public/admin.html`**: your results page at `/admin.html`. It shows feedback, mission pass rates and the most-missed checks, and needs the admin key.
- **`src/worker.js`**: serves the site and handles three routes:
  - `POST /api/feedback` saves a tester's feedback.
  - `POST /api/attempt` saves one scored mission.
  - `GET /api/admin/data` returns everything, and only with the admin key.
- **`schema.sql`**: the two database tables.
- **`wrangler.jsonc`**: the Worker settings. You paste one ID into it in step 2.

Testers can only add rows. Nobody can read them without the admin key.

## Set it up (Cloudflare dashboard, no command line)

### 1. Put the files on GitHub
1. On GitHub, create a new repository called `cadet-hf1`. It can be private.
2. Choose **Add file → Upload files**. Drag in everything from this folder, keeping the `public` and `src` folders as they are, and commit.

### 2. Create the database
1. In the Cloudflare dashboard, go to **Storage & Databases → D1 SQL Database → Create**.
2. Name it `cadet-hf1` and choose **Create**.
3. Copy the **Database ID** shown on the database's page.
4. Back on GitHub, open `wrangler.jsonc` and choose the pencil (edit) icon. Replace `PASTE-YOUR-DATABASE-ID-HERE` with the ID, then commit.

### 3. Create the tables
1. In Cloudflare, open the `cadet-hf1` database and choose **Console**.
2. Paste in the whole of `schema.sql` and choose **Execute**.
3. You should see two tables: `feedback` and `attempts`.

### 4. Deploy the Worker
1. Go to **Workers & Pages → Create → Import a repository**.
2. Pick `cadet-hf1`.
3. Leave the build settings as they are. The deploy command is `npx wrangler deploy`.
4. Choose **Save and Deploy**.

From now on, every commit to the repository redeploys the site automatically.

### 5. Set the admin key
1. Open the `cadet-hf1` Worker and go to **Settings → Variables and Secrets → Add**.
2. Set **Type** to Secret, **Variable name** to `ADMIN_KEY`, and **Value** to a long random phrase.
3. Choose **Deploy**.

### 6. Give it an address
1. In the Worker, go to **Settings → Domains & Routes → Add → Custom domain**.
2. Enter `hf1.ccistt.net`, or whatever name you prefer.

### 7. Check it works
1. Open the site, switch the radio on, and send a test from **FEEDBACK**.
2. Open `/admin.html`, enter your admin key, and choose **LOAD**. Your test entry should appear.

## What it stores (for the DPO note)

**Feedback**
- Stored: the optional name or callsign the tester types, their role, rating and comments, the browser's user-agent string, the screen size, and the radio's settings at the time.
- The form asks testers not to include personal details.

**Mission attempts**
- Stored: the station ID the tester chose (it defaults to `CADET`), the mission, the score, which checks passed, and the time taken.

**Not stored:** IP addresses, accounts, or anything that sticks around on the tester's device apart from the radio's own station log.

**Clearing the data:** open the D1 Console and run `DELETE FROM feedback; DELETE FROM attempts;`. It's worth setting a retention period for the test phase.

## Updating the radio

Edit `public/index.html` on GitHub, or upload a replacement, and commit. Cloudflare redeploys within a minute or two. Feedback rows record the version (`APP_VERSION` near the top of the page script), so you can tell which build a comment was about.
