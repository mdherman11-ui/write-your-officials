# Write Your Officials

A free, no-server web app. Pick a location, see every elected official who represents it (city council up to the U.S. Senate), write one message, and send each official their own copy from **your own Gmail**. Share the link and anyone else can connect their Gmail and do the same.

Runs entirely in the browser on GitHub Pages. No database, no backend, nothing stored about users.

## How it finds officials

| Level | Source | Email? |
|---|---|---|
| U.S. Senate and House | [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) + U.S. Census district lookup | No. Congress only accepts web forms, so the app lists their contact pages and a "Copy message" button |
| State legislature | [Open States](https://open.pluralpolicy.com) (free key) | Yes, for most states |
| City and county | [Cicero](https://www.cicerodata.com) (paid key, optional) and the community directory in `data/directory.json` | Yes, where published |
| Anyone else | "Add someone manually" in the app | Yes |

Location search uses OpenStreetMap. A full street address gives exact districts; a city name uses the city center.

**Coverage today:** North Royalton (mayor and full council, verified 2026-10-08), plus contact pages for Cuyahoga County, Cleveland City Council, and the Ohio Governor. Every other city works for federal and state officials, and its local officials can be added to `data/directory.json` (see below) or entered by hand.

## Setup (about 15 minutes, one time)

### 1. Publish on GitHub Pages
1. Push these files to a GitHub repository.
2. In the repo: **Settings > Pages > Build and deployment > Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. Your site will be at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

At this point the app already works in **"Open each in Gmail"** mode: it opens a pre-filled Gmail draft per official and you press Send on each.

### 2. Turn on one-click sending (Google OAuth Client ID)
1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project (e.g. "Write Your Officials").
2. **APIs & Services > Library**, search **Gmail API**, click **Enable**.
3. **APIs & Services > OAuth consent screen** (Google Auth Platform):
   - User type: **External**.
   - App name, support email, developer email: fill in.
   - Scopes: add `.../auth/gmail.send` and `.../auth/userinfo.email`.
   - **Audience / Test users:** add the Gmail address of every person who will use it (up to 100).
4. **APIs & Services > Credentials > Create credentials > OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: `https://YOUR-USERNAME.github.io`
   - No redirect URI is needed.
5. Copy the Client ID into `config.js` as `googleClientId`, commit, push.

**About Google's limits:** `gmail.send` is a "sensitive" scope. While the app is in *Testing* mode only the test users you list can sign in, and their sign-in lasts 7 days before they must reconnect. To let anyone use it without listing them, click **Publish app**; unverified apps show a "Google hasn't verified this app" screen (users click *Advanced > Go to app*) and are capped at 100 users. Removing that screen requires Google's verification review.

### 3. Optional data keys
- **Open States** (free): sign up at [open.pluralpolicy.com](https://open.pluralpolicy.com/accounts/profile/), put the key in `config.js` as `openStatesKey`. Adds state senators and representatives with emails.
- **Cicero** (paid, includes free trial credits): adds city and county officials in many places. Each user can paste their own key under **Settings** in the app instead of putting it in `config.js` (anything in `config.js` is public).

## Using it
1. Type an address or "City, ST" and click **Find officials**.
2. Untick anyone you do not want. Use **Also include another place** to add, for example, Cleveland officials.
3. Write the subject and message. `{{name}}`, `{{title}}` and `{{place}}` are filled in per recipient.
4. **Connect Gmail**, then **Send from my Gmail**. You see a preview, then each email goes out separately with a short pause between them. Everything appears in your Gmail Sent folder.
5. **Copy share link with this message** creates a link that pre-fills the location and message, so someone else only has to connect their Gmail and press Send.

Gmail allows roughly 500 messages a day from a personal account. The app caps each send at 150 (change `maxRecipientsPerSend` in `config.js`).

## Adding a city or county to the directory
Edit `data/directory.json` and add a block like this:

```json
{
  "id": "oh-parma",
  "name": "Parma",
  "scope": "city",
  "level": "local",
  "state": "OH",
  "county": "Cuyahoga",
  "match": ["parma"],
  "source": "https://www.cityofparma-oh.gov/...",
  "verified": "2026-10-08",
  "officials": [
    { "name": "Jane Doe", "title": "Mayor of Parma", "email": "mayor@example.gov" }
  ]
}
```

- `scope`: `city` (matched on the city name in `match`), `county` (matched on `county`), or `state` (everyone in that state).
- Leave `email` empty and set `form` to a URL when an office only takes a contact form.
- Please include the official source page and the date you checked it. Offices change after every election.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: site settings (Client ID, optional keys, send pacing)
- `data/directory.json`: community list of local officials

## Privacy
The Gmail permission requested is send-only; the app cannot read your inbox. The access token lives in browser memory and disappears when you close the tab. API keys entered under Settings are saved only in that browser.
