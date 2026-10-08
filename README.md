<div align="center">
<img src="favicon/favicon.svg" alt="Stando Logo" width="120" height="120" />

# STANDO
**S**mart **T**ap **A**ttendance **N**etwork & **D**ata **O**rganiser

</div>

Stando keeps course attendance in one place. Lecturers record attendance by
tapping student cards against a phone, then review and manage the records.
Students can check their attendance and submit absence requests from their browser.

Part of [bredliplaku.com](https://bredliplaku.com).

## Using Stando

Sign in with your authorised Google account to see your courses and the tools
available to you. Contact an administrator if you need access.

| User | What you can do |
|---|---|
| Students | View your attendance, register your card and request an excused absence with a supporting document. |
| Lecturers | Take attendance, correct records, review absence requests, send a student's card for approval, and trust devices (renaming or removing only their own). |
| Administrators | Everything above, plus the student list, card approvals, staff, courses and every trusted device. |

### Taking attendance

Choose a course and start scanning. Scanning works only on a trusted device:
on any other device, **Start scanning** opens **Settings → Trusted Devices**
instead, where you register it. Each card tap records the student's
attendance. A card that is not in the student list still records attendance,
but plays the failure sound and turns the scan result orange. You can search
records by name, card, date or session to find an entry or make a correction.

Scanning locks Stando so the phone can be left on a desk: the lock screen only
records attendance, showing each student's name under the clock (or the Card ID
of an unknown card). Swipe down to see the cards scanned so far. Any lecturer of
the course on screen taps their staff card to unlock it; a tap again (or 30
seconds untouched) locks it again. This needs your own card in
**Settings → Staff**; without it, scanning works but does not lock. A phone that
has confirmed a card once also unlocks with it offline. The lock covers every
Stando tab in the browser and stays after a reload. It cannot stop someone
switching to other apps or tabs, but the lock screen then shows when Stando was
left and for how long. Without a card, **Sign out** ends the session instead.

Card scanning uses NFC: it needs an NFC-capable Android phone, a supported
Chrome browser and an HTTPS website. You can view records without a card reader.

Students register a card by scanning it in **Register Card ID**; the Card ID is
stored in the card's chip and differs from any number printed on the card.
iPhones cannot scan, so a classmate with an Android phone chooses **Scan a
friend's card** and the student types the Card ID it shows.

If the connection drops, pending attendance changes stay on that device.
Reconnect and check the sync status to make sure they have been saved online.

### Student list and exports

Global administrators manage the student list in the **Student List** tab.
Upload an Excel or CSV file instead of entering everyone by hand: use
**Import → Download template** for a starting file, then review the preview:

- **Merge** adds new students and updates those with a matching card ID or email.
- **Replace All** replaces the entire student list.

Lecturers can export attendance for backup or later import. For courses using
EIS, **Add to EIS** copies a day's attendance; the
[EIS userscripts](extensions/) (installed with a userscript manager such as
Tampermonkey) fill it in on the EIS page.

<details>
<summary>Student import format</summary>

The template uses **Name**, **Card ID** and **Email**. Imports also accept older
**UID / Student ID** headings and an optional **Hardware UID** column.

Store card IDs as text to retain leading zeros; separate multiple IDs with
semicolons. Leave Hardware UID empty when it is unavailable. Each student needs
a name and either a card ID or email. Imports need an internet connection.

</details>

## Use Stando on another website

1. Sign in and click your photo or name. Lecturers choose **Download index.html**
   in **Settings → My Courses**; administrators find it at the top of
   **Settings → Courses**.
2. Upload the downloaded file as `index.html` to an HTTPS website folder,
   for example `https://example.com/attendance/`.
3. Ask the administrator to approve the website (below).

Every visitor signs in with their own account and sees the courses they can
access. App updates reach the page without another download.

## Administration

### Approve a new website

1. In Supabase, open **Authentication → URL Configuration → Redirect URLs** and
   add the page address, such as `https://example.com/attendance/`. On a domain
   only you publish to, `https://example.com/**` covers every folder.
2. Open **Edge Functions → Secrets** and save `STANDO_ALLOWED_ORIGINS` with the
   **complete** comma-separated list of approved websites, such as
   `https://example.com,https://example.org`. Saving replaces the whole value,
   and it is hidden afterwards, so keep your own copy of the list.
3. Optional: for Google's automatic sign-in prompt (One Tap), add the website to
   **Authorized JavaScript origins** of the Google Cloud OAuth client.

Without step 2 the page works, but emails and staff card sign-in fail there.
Sign-ins and trusted devices are separate on each website.

### Staff names and email signatures

Staff photos and default names come from each person's Google account after
their first sign-in. In **Settings → Staff**, leave a name or photo empty to use
the Google one, or enter a name, or the `https://` address of a photo, to
change it.

Approval and rejection emails are signed by whoever clicked, and replies go to
them. A name that starts with an academic title signs in full
("Assoc. Prof. Dr. Ana Hoxha"); other names sign with the first name ("Ana").

## Setup and maintenance

### What Stando runs on

| Service | Used for | Remember |
|---|---|---|
| GitHub Pages | Hosts this repository at `https://bredliplaku.com/stando/`. | Publishing = pushing to `main`. |
| Supabase | Sign-in, database, uploaded documents, and the `kiosk-login` and `send-email` functions. | Settings and secrets below. |
| Google Cloud | The OAuth client behind **Sign in with Google** and One Tap. | Supabase's Google provider uses its client ID and secret. |
| Resend | Sends every email, from an address on `bredliplaku.com`. | The domain must stay verified in Resend; its DNS records live at Porkbun. |
| Porkbun | Domain and DNS for `bredliplaku.com`. | Keep Resend's DNS records when changing DNS. The BIMI record shows the logo at `https://bredliplaku.com/miscellaneous/profile.svg` (personal website) next to emails. |

### Supabase settings

**Edge Functions → Secrets**

| Secret | Value |
|---|---|
| `RESEND_API_KEY` | From Resend → API Keys. |
| `MAIL_FROM` | The sender, such as `Stando <attendance@bredliplaku.com>`. It must use the domain verified in Resend. |
| `STANDO_ALLOWED_ORIGINS` | The approved websites (see above). |
| `STANDO_APP_URL` | Optional. Set only when Stando moves to a new address. |

**Authentication → URL Configuration:** the Site URL is Stando's address;
Redirect URLs list every page people sign in from.

If emails stop arriving, check that the domain is still verified and the API
key still valid in Resend, then look at the `send-email` logs in Supabase.

### Deploy the functions

After changing a function, open it in **Supabase → Edge Functions**, replace
`index.ts` with the file from [supabase/functions](supabase/functions/), and
click **Deploy updates**. Each file is self-contained. With the CLI:
`supabase functions deploy send-email` (or `kiosk-login`).

Database changes are in [supabase/migrations](supabase/migrations/): run a new
file once in **Supabase → SQL Editor** before publishing the app that needs it.

### Addresses

| Address | What it is |
|---|---|
| `https://bredliplaku.com/stando/` | Stando itself: this repository (`APP_URL` in [js/website.js](js/website.js)). |
| `https://bredliplaku.com/attendance/` | A personal-website folder with a global administrator's `index.html` and a forwarding `embed.js` for pages downloaded before the rename. |

Every downloaded `index.html` loads Stando from the address it was downloaded
from, so any address that ever served Stando must keep serving `embed.js`.

### Rename the repository to `stando`

This repository already points at `https://bredliplaku.com/stando/`, so work in
this order:

1. Rename the GitHub repository from `attendance` to `stando`, then push.
2. Straight away, add two files to `attendance/` in the personal website
   repository: your downloaded `index.html`, and this `embed.js`:

   ```js
   // Stando moved. Files downloaded earlier load this script; forward them.
   const script = document.createElement('script');
   script.src = 'https://bredliplaku.com/stando/embed.js';
   script.onerror = () => document.getElementById('stando-load-error').hidden = false;
   document.head.appendChild(script);
   ```

3. In Supabase, keep `https://bredliplaku.com/attendance/` in Redirect URLs and
   add `https://bredliplaku.com/stando/` (or use `https://bredliplaku.com/**`).
   Set the Site URL to `https://bredliplaku.com/stando/` and redeploy both
   functions.

The domain stays the same, so nothing else changes and nobody is signed out.

### Move to a new domain later

1. Publish Stando at the new address, such as `https://stando.al/`, and set
   `APP_URL` in [js/website.js](js/website.js) to it.
2. In Supabase, update the Site URL and Redirect URLs, set `STANDO_APP_URL`, and
   keep `https://bredliplaku.com` in `STANDO_ALLOWED_ORIGINS`. Add the new domain
   to the Google Cloud OAuth client.
3. Point the forwarding `embed.js` at the new address, and keep one at every
   earlier address, including `https://bredliplaku.com/stando/`.

Sign-ins and unsynced attendance belong to each domain: sync every scanning
device first. People then sign in again and trusted devices need approval again.

## Contributing

Bug fixes and improvements are welcome through pull requests.

## License

MIT License. See [LICENSE](LICENSE).

<div align="center">
<small>© 2025-2026 Bredli Plaku. All Rights Reserved.</small>
</div>
