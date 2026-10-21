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
available to you. Contact an administrator if you need access. After 30 minutes
without activity Stando signs you out, after a one-minute warning, but never
while scanning or while attendance on the device waits to sync.

| User | What you can do |
|---|---|
| Students | View your attendance, register your card or a friend's (choosing the programme) and request an excused absence with a supporting document. |
| Teaching assistants | Everything a student does. In the courses assigned to them: scan, add records, add or delete times on the records they made, and send an unknown card for approval. |
| Lecturers | Take attendance, correct records, review absence requests, send a student's card for approval, change their courses' programmes, sections and archiving, and trust devices (renaming or removing only their own). |
| Administrators | Everything above, plus the student list, card approvals, staff, courses (with their teaching assistants, icon and colours), programmes and every trusted device. |

Every dialog closes with the **×** in its title bar, a tap outside it or Escape.
If something in it was changed, Stando asks first: **Save**, **Discard** or
**Keep editing**.

The banner at the top shows the course on screen: its code above its name, such
as **CE 121 / Civil Engineering Drawing**, and the browser tab reads
"CE 121 Civil Engineering Drawing Attendance". Administrators set a course's
name in **Settings → Courses**; until then the banner shows the code alone.

### Taking attendance

Choose a course and start scanning. Scanning works only on a trusted device:
on any other device, **Start scanning** opens **Settings → Trusted Devices**
instead, where you register it. Each card tap records the student's
attendance. A card that is not in the student list still records attendance,
but plays the failure sound and turns the scan result orange. You can search
records by name, card, date or group to find an entry or make a correction.
In a record's **Edit**, **Select** ticks several of its times to change their
group or delete them together.

To change many records at once, choose **⋯ → Select records** (or hold a row
on a phone), then tap the rows or **Select all**. The bar at the bottom copies
them to another of your active courses (a global administrator: any course),
on a day you choose or their own days, adds or removes an hour, moves them to
another group or day, or deletes them. **×** or Escape stops selecting.

Scanning locks Stando so the phone can be left on a desk: the lock screen only
records attendance, showing each student's name in large type under the clock.
An unknown card shows ••••••••, there and in the scan result on an unlocked
phone; its Card ID shows in the attendance list. Swipe down to see the cards scanned so far. Any lecturer of
the course on screen taps their staff card to unlock it; a tap again (or 30
seconds untouched) locks it again. This needs your own card in
**Settings → Staff**; without it, scanning works but does not lock. A phone that
has confirmed a card once also unlocks with it offline. The lock covers every
Stando tab in the browser and stays after a reload. Without a card, **Sign
out** ends the session instead.

The phone reads cards only while Stando is on screen, so the screen stays on
while you scan. If Stando goes off screen anyway (the power button, another app
or tab, or the phone's own NFC screen), cards tapped meanwhile are not recorded,
and the lock screen says when and for how long, for example "Stando was off
screen at 12:34 for 11 s".

Card scanning uses Web NFC: it needs an Android phone with NFC switched on, a
browser that offers Web NFC, and an HTTPS website. Stando checks the browser
itself rather than its name: Chrome on Android works, and any other browser that
offers Web NFC (some Chromium-based Android browsers do) gets the scan button
too. iPhones and computers cannot scan. You can view records without a card
reader.

Students register their Student ID by scanning it in **Register Card ID**
(**Update Card ID** once a card is registered, for a new card). The card is read
from its chip; the Student ID No. printed on it is not used, and the Card ID that
is read stays hidden. iPhones cannot scan, so a classmate with an Android phone
taps **Scan for a friend** in the corner of the same dialog: they scan the card,
type its owner's name and email, choose the programme and tap **Send**. The
request is the friend's, scanned by them. Before submitting, students choose
their programme; an administrator can change it when approving the card.

**New cards** shows each card's Card ID with the UID it was read from; the Card
ID is always worked out from the UID. A card scanned by a friend says so, for
example "Scanned by Ana Hoxha for Arben Krasniqi". Approving opens with **Use UID** on; turn it off to save the Card ID
only. This needs
[supabase/migrations/registration_card_uid.sql](supabase/migrations/registration_card_uid.sql);
requests sent before this change show the Card ID alone.

On the sign-in page, a student's card is greeted with their name, as a check
that it works; a staff card signs in. The greeting needs the current
`kiosk-login` function (see [Deploy the functions](#deploy-the-functions)).

Changes and scans upload by themselves a couple of seconds after they are made;
the status at the top says **Saving…**, then **Saved**. The refresh button on
the Attendance and Students panels syncs everything at once. If the connection
drops, changes stay on that device (**Saved offline**) and upload when it is
back.

### Student list and exports

Global administrators manage the student list in the **Student List** tab, where
each student has a programme and the list can be filtered by programme. Opening
it stops scanning. Upload an Excel or CSV file instead of entering everyone by
hand: use **⋯ → Import → Download template** for a starting file, then review the
preview:

- **Merge** adds new students and updates those with a matching card ID or email.
- **Replace All** replaces the entire student list.

A card is known by its **Card ID**, the number a scan shows. Its **UID** (the
chip's own number, such as `b5:01:fa:ce`) is optional: under **More settings**,
turn on **Use UID** to type or scan it, and the Card ID then follows it. Cards
saved with a UID open with it on; turning it off and saving removes the UID and
keeps the Card ID. The same applies to staff cards. A scanned card request also
opens with it on, and turning it off just leaves the UID out.

Lecturers can export attendance for backup or later import. For courses using
EIS, **Add to EIS** copies a day's attendance; the
[EIS userscripts](extensions/) (installed with a userscript manager such as
Tampermonkey) fill it in on the EIS page.

<details>
<summary>Student import format</summary>

The template uses **Name**, **Card ID**, **Email** and **Programme**, and exports add
the card's **UID** (such as `b5:01:fa:ce`). Imports also accept the older **Student ID**
and **Hardware UID** headings.

Programme is optional. Use a code from **Settings → Programmes** (such as
`BA CE`) or its full name; an unknown programme stops the import at that row.
Instead of a column, you can choose one programme for every student in the file.
Students the file gives no programme keep the one they have.

Store card IDs as text to retain leading zeros; separate multiple IDs with
semicolons. Leave UID empty when it is unavailable. Each student needs
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

### Programmes

Administrators keep the list of study programmes in **Settings → Programmes**.
Each has a code (`BA CE`) and an optional full name (`Civil Engineering`),
shown to students as they choose.

Students are linked to a programme, not to its spelling, so:

- **Rename** a programme to correct its code or name; every student in it
  follows at once.
- **Archive** a programme you no longer offer. Its students keep it, but new
  registrations and new students cannot choose it.
- **Delete** a programme only to remove one made by mistake. If students are in
  it, you choose another programme and they move there first. Their cards and
  attendance are not affected.

Courses belong to programmes too, one or several (a course shared by two
degrees): add them under **Programmes** in the course's settings. Wherever
someone's courses span two or more programmes, Stando groups them by programme,
and a shared course shows under each: the course buttons, **Settings → Courses**
(with a Programme filter) and the course list of an absence request. Someone
whose courses are all in one programme sees no grouping. The course buttons
show each programme's code before its courses, and the chosen course shows its
full name. The copy of a shared course you choose is selected and its other copy
is outlined (tapping it says where it is already selected); the group buttons
(Theory, Lab, A, B) get their own **Group** label. This needs
[supabase/migrations/course_programmes.sql](supabase/migrations/course_programmes.sql),
then [course_programmes_multiple.sql](supabase/migrations/course_programmes_multiple.sql)
for more than one programme per course.

Programmes are listed A–Z by code everywhere. In a programme or course list,
typing a code (`BA CE`) shows just that programme, or its courses.

### Settings

Administrators and lecturers open **Settings** from their photo or name. Both
see the same tabs: Courses (a lecturer's own, as **My Courses**), Programmes,
Staff and Trusted Devices. In a course, lecturers change only its programmes,
sections and archiving; everything else, and the Programmes and Staff tabs, is
theirs to read. Lecturers still register and manage their own trusted devices.
An editor opened from Settings opens above it, and saving refreshes the list
under it.

### Teaching assistants

A teaching assistant is a student with a staff entry whose role is
**Teaching Assistant** (**Settings → Staff**), formerly "Student". Administrators
assign them to courses under **People** in a course's settings. In those courses
they see the whole attendance list, scan on their own phone (no trusted device,
no lock screen), choose the group, **Add** records, use **Add 1 hour** and
**Delete my latest time** on the rows they recorded, and send an unknown card's
**Register student** request. They have no Edit, no ⋯ menu and no Add to EIS.
Everywhere else they are a student. A lecturer's change to a record makes it
the lecturer's. Their staff card signs them in on any device.

### Course icon and colours

Administrators set each course's look under **Appearance** in its settings, with
a live preview. The **Icon** shows on the course's button: type a Font Awesome
class (`fa-solid fa-cube`) or paste the `<i>` tag Font Awesome copies; the
magnifier opens Font Awesome's free icons. Empty keeps the list icon. The five
**Colours** are primary (header and buttons), secondary (requests and
warnings), tertiary (information), success (adding and approving) and danger
(deleting and rejecting). While a course is open, the page takes its colours,
for everyone; **Reset to Stando's colours** puts the defaults back. Lecturers
see their courses' appearance without changing it.

Teaching assistants, the icon and the colours need
[supabase/migrations/assistants_and_course_appearance.sql](supabase/migrations/assistants_and_course_appearance.sql);
until it runs, those fields stay hidden.

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
