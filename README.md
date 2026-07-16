# SAP Next Gen Connections Passport ☕

A gamified coffee chat matching prototype for SAP Next Gen Early Talent participants. Connect with colleagues across global offices, earn passport stamps, and build your network one chat at a time.

## Features

- 🎰 Slot machine match finder with AI-generated icebreakers
- 🌍 Passport stamp collection by region and office
- 🏅 Milestone badges
- 📅 Meeting invite copy + Microsoft Teams deep link
- 🕐 Timezone overlap (friendly hours) visualizer
- 📝 Post-chat private notes
- 🔒 Privacy & GDPR consent flow
- ⏸️ Pause matching / permanent account deletion

## Tech stack

- React 18
- Vite
- Tailwind CSS
- lucide-react (icons)
- Anthropic API (icebreaker generation)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Color system

| Token | Hex | Usage |
|---|---|---|
| Primary Navy | `#002060` | Nav, headers, primary buttons |
| Bright Blue | `#1B90FF` | Interactive accent, active states |
| Light Blue | `#89D1FF` | Secondary accent, passive fills |
| Magenta | `#DF1278` | CTA buttons, alerts, stamps |
| Page Background | `#EAF5FF` | Main canvas |
| Panel Background | `#F5FAFF` | Sidebars, cards |

## Integration notes

Integration points are marked in `ConnectionsPassport.jsx`:
- `[SSO-INTEGRATION-POINT]` — replace demo user switcher with SAP SSO
- `[PROFILE-INTEGRATION-POINT]` — pull name/role/office from SAP People Profile
- `[BACKEND-INTEGRATION-POINT]` — connect state to a real database/API

## Project

Built as part of SAP Next Gen strategy and experience — People & Culture.
