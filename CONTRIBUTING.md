# Contributing to Connections Passport

This guide is for Allie, Mert, and anyone else making content or UI changes without going through Johnny.

---

## How to make a change and deploy it

1. **Edit the file** (see sections below for what lives where)
2. **Commit and push to `main`**
   ```
   git add src/ConnectionsPassport.jsx
   git commit -m "content: update [what you changed]"
   git push
   ```
3. **Build and deploy**
   ```
   mbt build
   cf login -a https://api.cf.us10.hana.ondemand.com
   echo "y" | cf deploy mta_archives/connections-passport_<version>.mtar
   ```
   > Bump the `version` field in `mta.yaml` by one patch (e.g. `1.1.3` → `1.1.4`) before building, otherwise CF may skip the upload.

---

## What lives where

All content lives in **`src/ConnectionsPassport.jsx`**. Open it and search (`Cmd+F`) for the section you want.

### Roles (dropdown on signup)
Search for: `const ROLES`

```js
const ROLES = [
  "STAR Student", "iXp Intern", "Academy Associate", "getX Early Talent",
];
```
Add or remove items from this array.

---

### Offices and countries
Search for: `const OFFICES`

Each entry looks like:
```js
{ office: "Berlin", country: "Germany", region: "EMEA", timezone: "CET" }
```
Add a new office by copying an existing line and changing the values. Make sure `region` is one of: `EMEA`, `APAC`, `NA`, `MEE`.

---

### Interest categories
Search for: `const INTEREST_CATEGORIES`

Each category has a `label` and an `items` array of strings. Add or rename interests freely — they appear as selectable chips on the signup form.

---

### Landing page copy
Search for: `function LandingPage`

The headline, subtitle, and step descriptions (`01`, `02`, `03`) are plain text inside JSX — edit them directly.

---

### Community guidelines text
Search for: `Community Guidelines`

The guidelines are a numbered list inside the signup flow. Each `<li>` is one rule — add, remove, or reword as needed.

---

### Tutorial steps (first-login overlay)
Search for: `const TUTORIAL_STEPS`

Each step has a `title` and `body`. Edit these to update what new users see when they first sign up.

---

### Badges
Search for: `const ALL_BADGES`

Each badge has a `name`, an `icon` (from Lucide), and a `desc` (tooltip text). The matching logic in the backend (`cap/srv/passport-service.js`) uses the names in `BADGE_FULL_NAMES` — if you rename a badge, update both arrays.

---

## Rules to avoid breaking things

- **Don't rename or delete** `const REGIONS`, `const OFFICES`, `const ROLES`, or `const ALL_BADGES` — they're referenced throughout the code.
- **Don't change field names** inside objects (e.g. `office:`, `region:`) — only change the string values.
- **Test locally first** if possible: `npm run dev` from the project root starts a local preview.
- When in doubt, ask Johnny before deploying to production.

---

## Need to change something in the database?

Data (users, matches, stamps) lives in HANA Cloud — it is **not** in any file. To query or fix data directly, contact Johnny, who has HANA access credentials.
