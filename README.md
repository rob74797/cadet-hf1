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

Testers can add feedback and results and read the active missions. Reading results and changing missions needs the admin key.

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
3. You should see three tables: `feedback`, `attempts` and `missions`.

**Already set up the database before missions were added?** Paste `migrations/002-missions-and-callsigns.sql` into the Console and choose **Execute** instead. It adds the missions table and leaves your existing results alone.

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

## Using it on a phone or tablet

- **Knobs:** touch a knob and swipe up or right to turn it up, down or left to turn it down. Touching a knob also opens a large **adjust panel** at the top of the display with a full-width slider and − / + buttons; hold a button to keep stepping. The panel closes itself after a few seconds, or press ×.
- **Main dial:** turn it round the edge, swipe across the middle, or use the swipe strip in its adjust panel. A quick flick keeps it spinning.
- Turn the phone sideways, and use **full screen** (the top-right button) for the most room.

## Your voice inside the radio

On the test site the radio uses the cadet's **microphone** by default. The first PTT press asks permission. If it's refused, the radio falls back to the recorded test call.

- **Meters follow the real voice.** PO, ALC and the splatter on the spectrum come from what the cadet actually says, for the test call and loaded clips too.
- **LIFT LID** shows the cadet's own voice at every transmit stage: microphone, mic amplifier, ADC, compressor, modulator, PA, low-pass filter and antenna. The scopes label the peak level and turn red with **CLIPPING** when they overdrive.
- **Transmit from inside the lid** with **HOLD TO TALK**, the space bar, or **VOX**. VOX transmits when you speak and drops back when you stop. VOX GAIN and VOX DELAY are on the microphone block inside the lid; the white mark on the MIC meter is the VOX threshold.
- MIC GAIN, COMP and PWR can be changed on their blocks while talking, so cadets see each one's effect straight away.
- While transmitting, the receive blocks go flat: the receiver is switched off.
- Use headphones with VOX so the speaker doesn't key the transmitter.

## Callsigns

Before a scored mission, the cadet enters their callsign. It's shown with Ø the way cadets write zero, and stored with a plain 0 so the same callsign always matches. The results page has a **Who has passed** grid with one row per callsign and one column per mission, plus a search box.

Callsigns are typed by the cadet, not checked against an account. A mistyped callsign shows up as its own row, and someone could type another cadet's callsign. Verified results arrive with GreenVoice sign-in.

## Building missions

Open the radio with `?builder` on the end of the address (for example `https://hf1.ccistt.net/?builder`) and press **BUILDER**.

1. **Details:** a title, the brief the cadet reads, and optionally a question with its answer.
2. **Starting state:** choose **Set it up on the radio**, put the radio how the cadet should find it (wrong, usually), and press **CAPTURE START**.
3. **Correct answer:** set the radio up correctly and press **CAPTURE ANSWER**. A table shows every setting that changed. For each one, choose the check:

   | Check | Use it for |
   | --- | --- |
   | Exact | One right answer, such as MODE = LSB |
   | Any of | Several right answers |
   | Range | Leeway, such as dial within 7.149 to 7.151 |
   | At most / At least | Limits, such as PWR at most 25 W |
   | Must not change | A setting the cadet should leave alone |
   | Must use | The control they should reach for |
   | Ignore | Anything that doesn't matter here |

   | In a band bank (MAIN DIAL only) | Any frequency a licence allows, by type: phone (SSB), CW and data, or any mode. Tick the bands that count. |

   Each check is **Good practice** or **Efficiency** (worth points) or **Licence** (must pass).
4. **Transmission and licence:**
   - The Foundation, Intermediate and Full templates add the power, band and clean-signal checks, measured on what was actually transmitted.
   - **Signal must stay inside a band bank** checks the transmitted signal's edges against the same banks, so an LSB signal hanging over a band edge fails.
   - You can also require ALC at zero, keep the signal inside a frequency range, or require the cadet to be tuned onto a station.
5. **Message station (optional):** put a station on any frequency inside an amateur band.
   - **CW:** type the message and set the speed.
   - **Voice:** record it with the builder's microphone (up to 20 seconds) or load a clip, and choose LSB or USB.
   - Set its strength and the pause between repeats. It behaves like the other stations: it fades, it shifts when mistuned, and the wrong sideband loses it.
   - Choose it under **Must be tuned onto** and ask a question about it in Details.
6. **Scoring:** the builder totals the points and suggests a pass mark of 70%. It warns you if:
   - your own answer fails a check
   - the starting state already passes
   - every check is an exact match
   - the station they must tune onto sits outside the dial's band bank

Press **TEST AS CADET** to try it; test attempts are not saved. Enter the admin key and press **SAVE MISSION**. Testers see it the next time they open MISSIONS. **LOAD SAVED** brings a mission back to edit. On the results page you can hide, show or delete built missions.

Answers to questions are stored as a fingerprint (a SHA-256 hash), so they can't be read from the page. Scoring runs in the cadet's browser, which is fine for testing but not tamper-proof.

## What it stores (for the DPO note)

**Feedback**
- Stored: the optional name or callsign the tester types, their role, rating and comments, the browser's user-agent string, the screen size, and the radio's settings at the time.
- The form asks testers not to include personal details.

**Mission attempts**
- Stored: the callsign the cadet entered, the mission, the score, which checks passed, and the time taken.

**Not stored:** IP addresses, accounts, or anything that sticks around on the tester's device apart from the radio's own station log.

**Clearing the data:** open the D1 Console and run `DELETE FROM feedback; DELETE FROM attempts;`. It's worth setting a retention period for the test phase.

## Updating the radio

Edit `public/index.html` on GitHub, or upload a replacement, and commit. Cloudflare redeploys within a minute or two. Feedback rows record the version (`APP_VERSION` near the top of the page script), so you can tell which build a comment was about.
