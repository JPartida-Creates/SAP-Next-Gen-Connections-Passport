import React, { useState, useMemo, useCallback } from "react";
import {
  Coffee, MapPin, Globe2, Stamp, User, Users, Shuffle, Check, Clock,
  X, ShieldCheck, ArrowRight, ArrowLeft, Sparkles, Building2, Award,
  ChevronRight, LogIn, LayoutDashboard, BadgeCheck, Hourglass, Eye, EyeOff
} from "lucide-react";

/* ============================================================
   SAP Next Gen Connections Passport — Prototype with CAP Backend
   ------------------------------------------------------------
   Single-file React app. When running on BTP the CAP backend
   persists all user/match data to HANA Cloud. On localhost the
   app falls back to in-memory demo mode automatically.
   Integration points are marked with:
     // [SSO-INTEGRATION-POINT], [BACKEND-INTEGRATION-POINT]
   ============================================================ */

/* ── API Client ────────────────────────────────────────────────
   All fetch calls route through the AppRouter which forwards
   the XSUAA bearer token. On localhost (no AppRouter) these
   calls will fail and the app stays in demo mode silently.
   ─────────────────────────────────────────────────────────── */

const API = {
  async _call(action, params = {}) {
    const res = await fetch(`/api/PassportService/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.status);
      throw new Error(`${action} failed: ${text}`);
    }
    return res.json();
  },
  async getMyState() {
    const res = await fetch("/api/PassportService/getMyState", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return null;
    const data = await res.json();
    // CAP wraps action return values in { value: "..." }
    const raw = data?.value ?? data;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  },
  upsertUser:      (profile)    => API._call("upsertUser",      { profile }),
  acceptMatch:     (otherEmail) => API._call("acceptMatch",     { otherEmail }),
  confirmMatch:    (matchId)    => API._call("confirmMatch",    { matchId }),
  acknowledgeMatch:(matchId)    => API._call("acknowledgeMatch",{ matchId }),
  removeMatch:     (matchId)    => API._call("removeMatch",     { matchId }),
  recordReshuffle: ()           => API._call("recordReshuffle"),
  pauseUser:       ()           => API._call("pauseUser"),
  deleteUser:      ()           => API._call("deleteUser"),
};

/* Normalize a user row from the CAP API into the shape the UI expects.
   HANA stores JSON fields as strings — parse them back to objects.
   Also maps `email` → `id` so existing components work without changes. */
function normalizeUser(u) {
  if (!u) return null;
  function parseJ(val, fallback) {
    if (!val) return fallback;
    if (typeof val !== "string") return val;
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return {
    ...u,
    id: u.email,                                          // UI uses .id for keys
    collectedRegions: parseJ(u.collectedRegions, {}),
    collectedOffices: parseJ(u.collectedOffices, {}),
    badges: parseJ(u.badges, []),
    interests: typeof u.interests === "string"
      ? u.interests.split(",").map(s => s.trim()).filter(Boolean)
      : (u.interests || []),
    timezone: getTimezone(u.office, u.country),
  };
}

/* Normalize a match from the CAP API: add userAId/userBId aliases so the
   MatchRow/MatchPanel components don't need to know about the email fields. */
function normalizeMatch(m) {
  if (!m) return null;
  return {
    ...m,
    userAId: m.userAEmail,
    userBId: m.userBEmail,
    // CAP timestamps are ISO strings; convert to ms for daysLeft math
    createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
    expiresAt: m.expiresAt ? new Date(m.expiresAt).getTime() : Date.now() + 7 * 86400000,
  };
}

/* ---------------------- Design tokens ----------------------
   Ink      #002060  primary dark / nav / headers
   Parchment#EAF5FF  passport page background
   Gold     #DF1278  stamp ink / primary accent
   Teal     #1B90FF  secondary accent (region color A)
   Coral    #002060  secondary accent (region color B)
   Sage     #7C8896  secondary accent (region color C)
   Type: display "Fraunces" (serif, stamp/passport feel),
         body "Inter", utility "IBM Plex Mono" (codes/IDs)
----------------------------------------------------------- */

/* ---------------------- Seed data ---------------------- */

const REGIONS = ["EMEA", "APAC", "NA", "MEE"];

const REGION_COLOR = {
  EMEA: { bg: "#1B90FF", text: "#FFFFFF" },
  APAC: { bg: "#89D1FF", text: "#002060" },
  NA:   { bg: "#002060", text: "#FFFFFF" },
  MEE:  { bg: "#DF1278", text: "#FFFFFF" },
};

// Simplified country SVG silhouettes (viewBox 0 0 100 100)
const COUNTRY_EMOJI = {
  "Germany":"🇩🇪","Ireland":"🇮🇪","United Kingdom":"🇬🇧","France":"🇫🇷",
  "India":"🇮🇳","Singapore":"🇸🇬","Japan":"🇯🇵","Australia":"🇦🇺",
  "United States":"🇺🇸","Canada":"🇨🇦","Brazil":"🇧🇷",
  "UAE":"🇦🇪","Saudi Arabia":"🇸🇦","South Africa":"🇿🇦",
  "Netherlands":"🇳🇱","Spain":"🇪🇸","Italy":"🇮🇹","Switzerland":"🇨🇭",
  "Sweden":"🇸🇪","Denmark":"🇩🇰","Poland":"🇵🇱","Austria":"🇦🇹",
  "Belgium":"🇧🇪","Portugal":"🇵🇹","Czech Republic":"🇨🇿","Hungary":"🇭🇺",
  "Romania":"🇷🇴","Finland":"🇫🇮","Norway":"🇳🇴","Turkey":"🇹🇷",
  "Israel":"🇮🇱","Egypt":"🇪🇬","Nigeria":"🇳🇬","Kenya":"🇰🇪",
  "China":"🇨🇳","South Korea":"🇰🇷","Malaysia":"🇲🇾","Philippines":"🇵🇭",
  "Thailand":"🇹🇭","Vietnam":"🇻🇳","New Zealand":"🇳🇿","Indonesia":"🇮🇩",
  "Mexico":"🇲🇽","Colombia":"🇨🇴","Argentina":"🇦🇷","Chile":"🇨🇱",
  "Qatar":"🇶🇦","Kuwait":"🇰🇼","Bahrain":"🇧🇭",
};

const OFFICES = [
  { office: "Abu Dhabi",        country: "UAE",            region: "MEE"  },
  { office: "Amsterdam",        country: "Netherlands",    region: "EMEA" },
  { office: "Atlanta",          country: "United States",  region: "NA"   },
  { office: "Auckland",         country: "New Zealand",    region: "APAC" },
  { office: "Bangalore",        country: "India",          region: "APAC" },
  { office: "Bangkok",          country: "Thailand",       region: "APAC" },
  { office: "Barcelona",        country: "Spain",          region: "EMEA" },
  { office: "Beijing",          country: "China",          region: "APAC" },
  { office: "Berlin",           country: "Germany",        region: "EMEA" },
  { office: "Bogotá",           country: "Colombia",       region: "NA"   },
  { office: "Boston",           country: "United States",  region: "NA"   },
  { office: "Brussels",         country: "Belgium",        region: "EMEA" },
  { office: "Bucharest",        country: "Romania",        region: "EMEA" },
  { office: "Budapest",         country: "Hungary",        region: "EMEA" },
  { office: "Buenos Aires",     country: "Argentina",      region: "NA"   },
  { office: "Cairo",            country: "Egypt",          region: "MEE"  },
  { office: "Cape Town",        country: "South Africa",   region: "MEE"  },
  { office: "Chicago",          country: "United States",  region: "NA"   },
  { office: "Copenhagen",       country: "Denmark",        region: "EMEA" },
  { office: "Dallas",           country: "United States",  region: "NA"   },
  { office: "Doha",             country: "Qatar",          region: "MEE"  },
  { office: "Dubai",            country: "UAE",            region: "MEE"  },
  { office: "Dublin",           country: "Ireland",        region: "EMEA" },
  { office: "Frankfurt",        country: "Germany",        region: "EMEA" },
  { office: "Geneva",           country: "Switzerland",    region: "EMEA" },
  { office: "Hamburg",          country: "Germany",        region: "EMEA" },
  { office: "Helsinki",         country: "Finland",        region: "EMEA" },
  { office: "Ho Chi Minh City", country: "Vietnam",        region: "APAC" },
  { office: "Hyderabad",        country: "India",          region: "APAC" },
  { office: "Istanbul",         country: "Turkey",         region: "MEE"  },
  { office: "Jakarta",          country: "Indonesia",      region: "APAC" },
  { office: "Jeddah",           country: "Saudi Arabia",   region: "MEE"  },
  { office: "Johannesburg",     country: "South Africa",   region: "MEE"  },
  { office: "Kuala Lumpur",     country: "Malaysia",       region: "APAC" },
  { office: "Kuwait City",      country: "Kuwait",         region: "MEE"  },
  { office: "Lagos",            country: "Nigeria",        region: "MEE"  },
  { office: "Lisbon",           country: "Portugal",       region: "EMEA" },
  { office: "London",           country: "United Kingdom", region: "EMEA" },
  { office: "Lyon",             country: "France",         region: "EMEA" },
  { office: "Madrid",           country: "Spain",          region: "EMEA" },
  { office: "Manama",           country: "Bahrain",        region: "MEE"  },
  { office: "Manila",           country: "Philippines",    region: "APAC" },
  { office: "Manchester",       country: "United Kingdom", region: "EMEA" },
  { office: "Melbourne",        country: "Australia",      region: "APAC" },
  { office: "Mexico City",      country: "Mexico",         region: "NA"   },
  { office: "Milan",            country: "Italy",          region: "EMEA" },
  { office: "Montreal",         country: "Canada",         region: "NA"   },
  { office: "Mumbai",           country: "India",          region: "APAC" },
  { office: "Munich",           country: "Germany",        region: "EMEA" },
  { office: "Nairobi",          country: "Kenya",          region: "MEE"  },
  { office: "New Delhi",        country: "India",          region: "APAC" },
  { office: "New York",         country: "United States",  region: "NA"   },
  { office: "Newtown Square",   country: "United States",  region: "NA"   },
  { office: "Oslo",             country: "Norway",         region: "EMEA" },
  { office: "Osaka",            country: "Japan",          region: "APAC" },
  { office: "Palo Alto",        country: "United States",  region: "NA"   },
  { office: "Paris",            country: "France",         region: "EMEA" },
  { office: "Prague",           country: "Czech Republic", region: "EMEA" },
  { office: "Rio de Janeiro",   country: "Brazil",         region: "NA"   },
  { office: "Riyadh",           country: "Saudi Arabia",   region: "MEE"  },
  { office: "Rome",             country: "Italy",          region: "EMEA" },
  { office: "San Ramon",        country: "United States",  region: "NA"   },
  { office: "Santiago",         country: "Chile",          region: "NA"   },
  { office: "São Paulo",        country: "Brazil",         region: "NA"   },
  { office: "Seattle",          country: "United States",  region: "NA"   },
  { office: "Seoul",            country: "South Korea",    region: "APAC" },
  { office: "Shanghai",         country: "China",          region: "APAC" },
  { office: "Shenzhen",         country: "China",          region: "APAC" },
  { office: "Singapore",        country: "Singapore",      region: "APAC" },
  { office: "Stockholm",        country: "Sweden",         region: "EMEA" },
  { office: "Sydney",           country: "Australia",      region: "APAC" },
  { office: "Tel Aviv",         country: "Israel",         region: "MEE"  },
  { office: "Tokyo",            country: "Japan",          region: "APAC" },
  { office: "Toronto",          country: "Canada",         region: "NA"   },
  { office: "Vancouver",        country: "Canada",         region: "NA"   },
  { office: "Vienna",           country: "Austria",        region: "EMEA" },
  { office: "Walldorf",         country: "Germany",        region: "EMEA" },
  { office: "Warsaw",           country: "Poland",         region: "EMEA" },
  { office: "Washington DC",    country: "United States",  region: "NA"   },
  { office: "Zurich",           country: "Switzerland",    region: "EMEA" },
];

const TIMEZONES = {
  "Germany": "CET (UTC+1)", "Ireland": "GMT (UTC+0)", "United Kingdom": "GMT (UTC+0)",
  "France": "CET (UTC+1)", "India": "IST (UTC+5:30)", "Singapore": "SGT (UTC+8)",
  "Japan": "JST (UTC+9)", "Australia": "AEST (UTC+10)", "United States": "EST (UTC-5)",
  "Canada": "ET (UTC-5)", "Brazil": "BRT (UTC-3)",
  "UAE": "GST (UTC+4)", "Saudi Arabia": "AST (UTC+3)", "South Africa": "SAST (UTC+2)",
  "Netherlands": "CET (UTC+1)", "Spain": "CET (UTC+1)", "Italy": "CET (UTC+1)",
  "Switzerland": "CET (UTC+1)", "Sweden": "CET (UTC+1)", "Denmark": "CET (UTC+1)",
  "Poland": "CET (UTC+1)", "Austria": "CET (UTC+1)", "Belgium": "CET (UTC+1)",
  "Portugal": "WET (UTC+0)", "Czech Republic": "CET (UTC+1)", "Hungary": "CET (UTC+1)",
  "Romania": "EET (UTC+2)", "Finland": "EET (UTC+2)", "Norway": "CET (UTC+1)",
  "Turkey": "TRT (UTC+3)", "Israel": "IST (UTC+2)", "Egypt": "EET (UTC+2)",
  "Nigeria": "WAT (UTC+1)", "Kenya": "EAT (UTC+3)",
  "China": "CST (UTC+8)", "South Korea": "KST (UTC+9)", "Malaysia": "MYT (UTC+8)",
  "Philippines": "PHT (UTC+8)", "Thailand": "ICT (UTC+7)", "Vietnam": "ICT (UTC+7)",
  "New Zealand": "NZST (UTC+12)", "Indonesia": "WIB (UTC+7)",
  "Mexico": "CST (UTC-6)", "Colombia": "COT (UTC-5)", "Argentina": "ART (UTC-3)", "Chile": "CLT (UTC-3)",
  "Qatar": "AST (UTC+3)", "Kuwait": "AST (UTC+3)", "Bahrain": "AST (UTC+3)",
};

const OFFICE_TIMEZONES = {
  "Palo Alto": "PST (UTC-8)", "Seattle": "PST (UTC-8)",
  "Vancouver": "PST (UTC-8)",
  "New York": "EST (UTC-5)", "Boston": "EST (UTC-5)", "Atlanta": "EST (UTC-5)",
  "Washington DC": "EST (UTC-5)", "Newtown Square": "EST (UTC-5)",
  "Chicago": "CST (UTC-6)", "Dallas": "CST (UTC-6)",
  "Toronto": "EST (UTC-5)", "Montreal": "EST (UTC-5)",
  "Ho Chi Minh City": "ICT (UTC+7)",
};

function getTimezone(office, country) {
  return OFFICE_TIMEZONES[office] || TIMEZONES[country] || "UTC+0";
}

const COUNTRY_IANA = {
  "Germany": "Europe/Berlin", "Ireland": "Europe/Dublin",
  "United Kingdom": "Europe/London", "France": "Europe/Paris",
  "India": "Asia/Kolkata", "Singapore": "Asia/Singapore",
  "Japan": "Asia/Tokyo", "Australia": "Australia/Sydney",
  "United States": "America/New_York", "Canada": "America/Toronto",
  "Brazil": "America/Sao_Paulo", "UAE": "Asia/Dubai",
  "Saudi Arabia": "Asia/Riyadh", "South Africa": "Africa/Johannesburg",
  "Netherlands": "Europe/Amsterdam", "Spain": "Europe/Madrid",
  "Italy": "Europe/Rome", "Switzerland": "Europe/Zurich",
  "Sweden": "Europe/Stockholm", "Denmark": "Europe/Copenhagen",
  "Poland": "Europe/Warsaw", "Austria": "Europe/Vienna",
  "Belgium": "Europe/Brussels", "Portugal": "Europe/Lisbon",
  "Czech Republic": "Europe/Prague", "Hungary": "Europe/Budapest",
  "Romania": "Europe/Bucharest", "Finland": "Europe/Helsinki",
  "Norway": "Europe/Oslo", "Turkey": "Europe/Istanbul",
  "Israel": "Asia/Jerusalem", "Egypt": "Africa/Cairo",
  "Nigeria": "Africa/Lagos", "Kenya": "Africa/Nairobi",
  "China": "Asia/Shanghai", "South Korea": "Asia/Seoul",
  "Malaysia": "Asia/Kuala_Lumpur", "Philippines": "Asia/Manila",
  "Thailand": "Asia/Bangkok", "Vietnam": "Asia/Ho_Chi_Minh",
  "New Zealand": "Pacific/Auckland", "Indonesia": "Asia/Jakarta",
  "Mexico": "America/Mexico_City", "Colombia": "America/Bogota",
  "Argentina": "America/Argentina/Buenos_Aires", "Chile": "America/Santiago",
  "Qatar": "Asia/Qatar", "Kuwait": "Asia/Kuwait", "Bahrain": "Asia/Bahrain",
};

const OFFICE_IANA = {
  "Palo Alto": "America/Los_Angeles", "Seattle": "America/Los_Angeles",
  "Vancouver": "America/Vancouver",
  "Newtown Square": "America/New_York", "New York": "America/New_York",
  "Boston": "America/New_York", "Atlanta": "America/New_York",
  "Washington DC": "America/New_York",
  "Chicago": "America/Chicago", "Dallas": "America/Chicago",
  "Toronto": "America/Toronto", "Montreal": "America/Toronto",
  "Ho Chi Minh City": "Asia/Ho_Chi_Minh",
  "Melbourne": "Australia/Melbourne",
  "Auckland": "Pacific/Auckland",
};
function getIANA(office, country) {
  return OFFICE_IANA[office] || COUNTRY_IANA[country] || "UTC";
}

// Get current UTC offset in hours for an IANA timezone (accounts for DST)
function getCurrentOffset(iana) {
  const now = new Date();
  const utcStr = now.toLocaleString("en-US", { timeZone: "UTC" });
  const localStr = now.toLocaleString("en-US", { timeZone: iana });
  return (new Date(localStr) - new Date(utcStr)) / 3600000;
}

// Format current time in an IANA timezone
function fmtTimeInTz(iana) {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: iana });
}

// Returns 24-slot overlap grid using current DST-aware offsets
function getOverlapGrid(iana1, iana2) {
  const off1 = getCurrentOffset(iana1);
  const off2 = getCurrentOffset(iana2);
  return Array.from({ length: 24 }, (_, utcHour) => {
    const h1 = ((utcHour + off1) % 24 + 24) % 24;
    const h2 = ((utcHour + off2) % 24 + 24) % 24;
    const a1 = h1 >= 9 && h1 < 17;
    const a2 = h2 >= 9 && h2 < 17;
    return { a1, a2, both: a1 && a2 };
  });
}

const INTEREST_CATEGORIES = [
  {
    label: "Tech & Innovation",
    emoji: "💻",
    items: ["AI & ML", "Cloud Architecture", "Data Analytics", "Cybersecurity", "Product Design", "UX Research", "Startups", "Blockchain"],
  },
  {
    label: "Business & Career",
    emoji: "📈",
    items: ["Sales Strategy", "Career Mentoring", "Public Speaking", "Leadership", "Entrepreneurship", "Finance & Markets", "Consulting", "Project Management"],
  },
  {
    label: "Creativity & Culture",
    emoji: "🎨",
    items: ["Music", "Photography", "Writing", "Film & TV", "Gaming", "Design", "Art", "Podcasting"],
  },
  {
    label: "Lifestyle & Wellbeing",
    emoji: "🌿",
    items: ["Travel", "Running", "Fitness", "Cooking", "Mindfulness", "Sustainability", "Yoga", "Hiking", "Football", "Basketball", "Cycling", "Swimming", "Tennis", "Martial Arts", "Mental Health", "Nutrition"],
  },
  {
    label: "Learning & Community",
    emoji: "🌍",
    items: ["Languages", "Volunteering", "DEI & Inclusion", "Mentoring Students", "Book Clubs", "Social Impact", "Networking", "Teaching"],
  },
];

const INTEREST_POOL = INTEREST_CATEGORIES.flatMap(c => c.items);

const ROLES = [
  "STAR Student", "iXp Intern", "Academy Associate", "getX Early Talent",
];

const FIRST_NAMES = ["Maya", "Lucas", "Amara", "Felix", "Priya", "Noah", "Sofia", "Kenji",
  "Elena", "Tariq", "Hana", "Diego", "Ingrid", "Yuki", "Owen", "Camila"];
const LAST_NAMES = ["Schmidt", "Okafor", "Nakamura", "Silva", "Müller", "Patel", "Dubois",
  "Larsen", "Costa", "Bianchi", "Kim", "Hayes", "Novak", "Reyes"];

function seedUsers() {
  // [PROFILE-INTEGRATION-POINT] In production, fields below (name, role,
  // region, country, office, timezone) would be pre-filled from SAP
  // People Profile after SSO login rather than entered manually.
  const users = [];
  let id = 1;
  FIRST_NAMES.forEach((fn, i) => {
    const ln = LAST_NAMES[i % LAST_NAMES.length];
    const officeInfo = OFFICES[i % OFFICES.length];
    const numInterests = 2 + (i % 3);
    const interests = Array.from(new Set(
      Array.from({ length: numInterests }, (_, k) => INTEREST_POOL[(i * 3 + k) % INTEREST_POOL.length])
    ));
    users.push({
      id: id++,
      name: `${fn} ${ln}`,
      role: ROLES[i % ROLES.length],
      region: officeInfo.region,
      country: officeInfo.country,
      office: officeInfo.office,
      timezone: getTimezone(officeInfo.office, officeInfo.country),
      interests,
      optedIn: true,
      paused: false,
      deleted: false,
      consentGiven: true, // seeded users pre-consented for demo
      isDemo: true, // excluded from matching for real signed-up users
      collectedRegions: {}, // region -> count
      collectedOffices: {}, // office -> count
      chatsCompleted: 0,
      badges: [],
      lastReshuffleDate: null,
      reshufflesUsedToday: 0,
      lastMatchAcceptDate: null,
      matchesAcceptedToday: 0,
    });
  });
  return users;
}

function seedMatches(users) {
  // A couple of pre-existing matches/history so pages aren't empty on load.
  const now = Date.now();
  const matches = [];
  let mid = 1;

  function addMatch({ aId, bId, status, daysAgo, confirmedA, confirmedB }) {
    matches.push({
      id: mid++,
      userAId: aId,
      userBId: bId,
      createdAt: now - daysAgo * 86400000,
      expiresAt: now - daysAgo * 86400000 + 7 * 86400000,
      status, // 'active' | 'pending_confirmation' | 'completed' | 'expired'
      confirmedA: !!confirmedA,
      confirmedB: !!confirmedB,
    });
  }

  addMatch({ aId: 1, bId: 9, status: "completed", daysAgo: 12, confirmedA: true, confirmedB: true });
  addMatch({ aId: 1, bId: 4, status: "pending_confirmation", daysAgo: 2, confirmedA: true, confirmedB: false });
  addMatch({ aId: 1, bId: 7, status: "active", daysAgo: 1, confirmedA: false, confirmedB: false });
  addMatch({ aId: 1, bId: 11, status: "expired", daysAgo: 10, confirmedA: false, confirmedB: false });
  addMatch({ aId: 2, bId: 1, status: "completed", daysAgo: 20, confirmedA: true, confirmedB: true });
  addMatch({ aId: 3, bId: 1, status: "completed", daysAgo: 18, confirmedA: true, confirmedB: true });

  // Apply completed-match effects to user 1's passport for a realistic demo.
  applyStampsForCompletedSeed(users, matches);
  return matches;
}

function applyStampsForCompletedSeed(users, matches) {
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  matches.filter((m) => m.status === "completed").forEach((m) => {
    awardStamps(byId[m.userAId], byId[m.userBId]);
    awardStamps(byId[m.userBId], byId[m.userAId]);
  });
  users.forEach((u) => recalcBadges(u));
}

function awardStamps(user, otherUser) {
  user.collectedRegions[otherUser.region] = (user.collectedRegions[otherUser.region] || 0) + 1;
  user.collectedOffices[otherUser.office] = (user.collectedOffices[otherUser.office] || 0) + 1;
  user.chatsCompleted += 1;
}

function recalcBadges(user) {
  const badges = [];
  const regionCount = Object.keys(user.collectedRegions).length;
  const officeCount = Object.keys(user.collectedOffices).length;
  const totalStamps = Object.values(user.collectedRegions).reduce((s,c)=>s+c,0)
                    + Object.values(user.collectedOffices).reduce((s,c)=>s+c,0);
  // Chat milestones
  if (user.chatsCompleted >= 1)  badges.push("First Connection");
  if (user.chatsCompleted >= 5)  badges.push("5 Chats Completed");
  if (user.chatsCompleted >= 10) badges.push("10 Chats Completed");
  if (user.chatsCompleted >= 20) badges.push("20 Chats Completed");
  // Region milestones
  if (user.collectedRegions["EMEA"])  badges.push("EMEA Explorer");
  if (user.collectedRegions["APAC"])  badges.push("APAC Explorer");
  if (user.collectedRegions["NA"])    badges.push("NA Explorer");
  if (user.collectedRegions["MEE"])   badges.push("MEE Explorer");
  if (regionCount >= 3)               badges.push("3 Regions Collected");
  if (regionCount >= REGIONS.length)  badges.push("Global Explorer");
  // Office milestones
  if (officeCount >= 5)  badges.push("5 Offices Collected");
  if (officeCount >= 10) badges.push("Office Hopper");
  if (officeCount >= 14) badges.push("Stamp Collector");
  // Stamp milestones
  if (totalStamps >= 10) badges.push("Passport Pro");
  user.badges = badges;
  return badges;
}

/* ---------------------- Matching algorithm ----------------------
   Easy to read/modify: filter candidates, then score them.
   Higher score = more preferred match.
------------------------------------------------------------------- */
function getPriorMatchedUserIds(matches, userId) {
  const ids = new Set();
  matches.forEach((m) => {
    if (m.userAId === userId) ids.add(m.userBId);
    if (m.userBId === userId) ids.add(m.userAId);
  });
  return ids;
}

function scoreCandidate(user, candidate) {
  let score = 0;
  // Prefer offices/regions not yet collected.
  if (!user.collectedRegions[candidate.region]) score += 3;
  if (!user.collectedOffices[candidate.office]) score += 2;
  // Light bonus for shared interests (keeps chats relevant without being a hard rule).
  const shared = candidate.interests.filter((i) => user.interests.includes(i)).length;
  score += Math.min(shared, 2) * 0.5;
  return score;
}

function findMatchCandidates(users, matches, currentUser, excludeIds = []) {
  const priorIds = getPriorMatchedUserIds(matches, currentUser.id);
  // Real users only match with other real users; demo seed data is excluded
  const realUser = !currentUser.isDemo;
  const candidates = users.filter((u) =>
    u.id !== currentUser.id &&
    u.optedIn &&
    !u.paused &&
    !u.deleted &&
    !priorIds.has(u.id) &&
    !excludeIds.includes(u.id) &&
    (realUser ? !u.isDemo : true)
  );
  return candidates
    .map((c) => ({ candidate: c, score: scoreCandidate(currentUser, c) }))
    .sort((a, b) => b.score - a.score);
}

function suggestMatch(users, matches, currentUser, excludeIds = []) {
  const ranked = findMatchCandidates(users, matches, currentUser, excludeIds);
  if (ranked.length === 0) return null;
  // Take from the top-scoring tier, slight randomization so it doesn't feel robotic.
  const topScore = ranked[0].score;
  const topTier = ranked.filter((r) => r.score >= topScore - 1);
  return topTier[Math.floor(Math.random() * topTier.length)].candidate;
}

const MAX_RESHUFFLES_PER_DAY = 3;
const MAX_MATCHES_PER_DAY = 3;
function todayStr() {
  return new Date().toDateString();
}

/* ---------------------- Small UI atoms ---------------------- */


/* ============================================================
   DASHBOARD UI — single-screen 3-panel layout
   Left:   My Passport (stamps + badges)
   Center: Coffee Match finder
   Right:  Active Matches
   Admin overlay replaces center+right when toggled.
   ============================================================ */

/* ---------------------- Shared atoms ---------------------- */

function useFonts() {
  React.useEffect(() => {
    const id = "cp-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

function Pill({ children, color = "#002060", textColor = "#fff" }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: color, color: textColor }}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, icon: Icon, sm }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed";
  const size = sm ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const vars = {
    primary: { backgroundColor: "#002060", color: "#fff" },
    magenta: { backgroundColor: "#DF1278", color: "#fff" },
    secondary: { backgroundColor: "#fff", color: "#002060", border: "1px solid #CFE6FA" },
    ghost: { backgroundColor: "transparent", color: "#002060" },
    blue: { backgroundColor: "#1B90FF", color: "#fff" },
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${size}`} style={vars[variant]}>
      {Icon && <Icon size={sm ? 13 : 15} />}{children}
    </button>
  );
}

function gravatarUrl(email, size) {
  if (!email) return null;
  // MD5 hash of lowercase trimmed email — Gravatar's required format
  const normalized = email.trim().toLowerCase();
  let hash = 0;
  // Simple djb2-style hash is NOT MD5 — use the SubtleCrypto approach via cached async
  // but since we need sync rendering, we use a precomputed cache stored in module scope.
  return `https://www.gravatar.com/avatar/${gravatarMd5(normalized)}?s=${size * 2}&d=404`;
}

// Tiny synchronous MD5 implementation (RFC 1321) for Gravatar hashing.
// No external dependency needed — Gravatar requires MD5 of the email.
function gravatarMd5(str) {
  function safeAdd(x, y) { const lsw=(x&0xffff)+(y&0xffff); return (((x>>16)+(y>>16)+(lsw>>16))<<16)|(lsw&0xffff); }
  function bitRotateLeft(num, cnt) { return (num<<cnt)|(num>>>(32-cnt)); }
  function md5cmn(q,a,b,x,s,t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b); }
  function md5ff(a,b,c,d,x,s,t){return md5cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function md5gg(a,b,c,d,x,s,t){return md5cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function md5hh(a,b,c,d,x,s,t){return md5cmn(b^c^d,a,b,x,s,t);}
  function md5ii(a,b,c,d,x,s,t){return md5cmn(c^(b|(~d)),a,b,x,s,t);}
  function md5blks(s){const b=[];for(let i=0;i<s.length*32;i+=8)b[i>>5]|=(s.charCodeAt(i/8)&0xff)<<(i%32);b[(s.length*8+64>>>9<<4)+14]=s.length*8;return b;}
  const x=md5blks(str);let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
  for(let i=0;i<x.length;i+=16){const [oa,ob,oc,od]=[a,b,c,d];
    a=md5ff(a,b,c,d,x[i],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330);
    a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983);
    a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329);
    a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i],20,-373897302);
    a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848);
    a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501);
    a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556);
    a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189);
    a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651);
    a=md5ii(a,b,c,d,x[i],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055);
    a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799);
    a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649);
    a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551);
    a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od);
  }
  return [a,b,c,d].map(n=>('00000000'+(n>>>0).toString(16)).slice(-8).match(/../g).map(h=>h[1]+h[0]).join('')).join('');
}

function Avatar({ name, email, size = 36 }) {
  const initials = name.split(" ").map(p => p[0]).slice(0, 2).join("");
  const [imgFailed, setImgFailed] = React.useState(false);
  const url = email && !imgFailed ? gravatarUrl(email, size) : null;

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setImgFailed(true)}
        className="rounded-full shrink-0 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div className="rounded-full flex items-center justify-center font-semibold shrink-0"
      style={{ width: size, height: size, backgroundColor: "#D1EFFF", color: "#002060", fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

function FixedTooltip({ anchorRef, children, open }) {
  const [style, setStyle] = React.useState(null);
  const TOOLTIP_W = 224; // w-56 = 224px

  React.useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: prefer right of button, flip left if it would overflow
    const fitsRight = r.right + 8 + TOOLTIP_W < vw;
    const left = fitsRight ? r.right + 8 : r.left - TOOLTIP_W - 8;

    // Vertical: anchor to bottom of button, flip up if it would overflow
    const tooltipH = 130; // approximate
    const top = r.bottom + tooltipH > vh ? r.top - tooltipH : r.bottom + 4;

    setStyle({ position: "fixed", top, left, zIndex: 9999, pointerEvents: "none" });
  }, [open]);

  if (!open || !style) return null;
  return <div style={style}>{children}</div>;
}

function PanelHeader({ children, icon: Icon, right }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: "#CFE6FA" }}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]"
        style={{ color: "#5A6472", fontFamily: "'IBM Plex Mono', monospace" }}>
        {Icon && <Icon size={13} />}{children}
      </div>
      {right}
    </div>
  );
}

function StatusDot({ status }) {
  const colors = { active: "#1B90FF", pending_confirmation: "#DF1278", completed: "#002060", expired: "#7C8896" };
  const labels = { active: "Active", pending_confirmation: "Pending", completed: "Done", expired: "Expired" };
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: colors[status] || "#7C8896" }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: colors[status] || "#7C8896" }} />
      {labels[status] || status}
    </span>
  );
}

function StampChip({ label, count, color, textColor, country }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: color, color: textColor, border: `1px solid ${color}` }}>
      {country && (
        <span className="text-sm leading-none">{COUNTRY_EMOJI[country] || "🌐"}</span>
      )}
      {label}
      {count > 1 && <span className="font-mono opacity-75">×{count}</span>}
    </span>
  );
}

// Larger stamp card for the dedicated Passport page
function StampCard({ label, count, color, textColor, country, sublabel }) {
  return (
    <div className="flex flex-col items-center justify-between rounded-xl p-3 gap-2"
      style={{
        backgroundColor: color,
        border: `2px double rgba(255,255,255,0.3)`,
        minWidth: 90, minHeight: 110,
        transform: `rotate(${(label.charCodeAt(0) % 7) - 3}deg)`,
        boxShadow: "0 2px 8px rgba(0,32,96,0.18)",
      }}>
      <div className="flex items-center justify-center flex-1">
        {country
          ? <span style={{ fontSize: 32, lineHeight: 1 }}>{COUNTRY_EMOJI[country] || "🌐"}</span>
          : <Globe2 size={28} color={textColor} opacity={0.7} />
        }
      </div>
      <div className="text-center">
        <div className="text-[10px] font-bold uppercase tracking-wide leading-tight"
          style={{ color: textColor, fontFamily: "'IBM Plex Mono', monospace" }}>
          {label}
        </div>
        {sublabel && (
          <div className="text-[9px] opacity-70 mt-0.5" style={{ color: textColor }}>{sublabel}</div>
        )}
      </div>
      {count > 1 && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
          style={{ backgroundColor: "#DF1278", color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>
          ×{count}
        </div>
      )}
    </div>
  );
}

/* ---------------------- Left panel: Passport ---------------------- */

// [label, icon, description]
const ALL_BADGES = [
  { name: "First Connection",    icon: Coffee,    desc: "Complete your very first coffee chat." },
  { name: "5 Chats",            icon: Coffee,    desc: "Complete 5 coffee chats total." },
  { name: "10 Chats",           icon: Coffee,    desc: "Complete 10 coffee chats total." },
  { name: "20 Chats",           icon: Coffee,    desc: "Complete 20 coffee chats — you're a connector." },
  { name: "EMEA Explorer",      icon: Globe2,    desc: "Connect with someone from the EMEA region." },
  { name: "APAC Explorer",      icon: Globe2,    desc: "Connect with someone from the APAC region." },
  { name: "NA Explorer",        icon: Globe2,    desc: "Connect with someone from the NA region." },
  { name: "MEE Explorer",       icon: Globe2,    desc: "Connect with someone from the MEE region." },
  { name: "3 Regions",         icon: Globe2,    desc: "Collect stamps from 3 different regions." },
  { name: "Global Explorer",   icon: Sparkles,  desc: "Collect stamps from all 4 SAP Next Gen regions." },
  { name: "5 Offices",         icon: Building2, desc: "Collect stamps from 5 different SAP offices." },
  { name: "Office Hopper",     icon: Building2, desc: "Collect stamps from 10 different SAP offices." },
  { name: "Stamp Collector",   icon: Stamp,     desc: "Collect stamps from 14 unique offices — almost everywhere!" },
  { name: "Passport Pro",      icon: Award,     desc: "Accumulate 10 total passport stamps." },
];

const BADGE_FULL_NAMES = ALL_BADGES.map((_, i) => [
  "First Connection","5 Chats Completed","10 Chats Completed","20 Chats Completed",
  "EMEA Explorer","APAC Explorer","NA Explorer","MEE Explorer",
  "3 Regions Collected","Global Explorer",
  "5 Offices Collected","Office Hopper","Stamp Collector","Passport Pro",
][i]);

function PassportPanel({ user }) {
  const regionEntries = Object.entries(user.collectedRegions);
  const officeEntries = Object.entries(user.collectedOffices);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: "#F5FAFF" }}>
      <PanelHeader icon={Stamp}>My Passport</PanelHeader>

      {/* User card */}
      <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: "#CFE6FA" }}>
        <Avatar name={user.name} email={user.email} size={40} />
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate" style={{ color: "#002060", fontFamily: "'Fraunces', serif" }}>
            {user.name}
          </div>
          <div className="text-xs text-[#5A6472] truncate">{user.role}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin size={11} color="#7C8896" />
            <span className="text-xs text-[#7C8896]">{user.office}</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 border-b" style={{ borderColor: "#CFE6FA" }}>
        {[
          { label: "Chats", value: user.chatsCompleted },
          { label: "Regions", value: `${Object.keys(user.collectedRegions).length}/${REGIONS.length}` },
          { label: "Offices", value: Object.keys(user.collectedOffices).length },
        ].map(s => (
          <div key={s.label} className="px-3 py-2 text-center border-r last:border-r-0" style={{ borderColor: "#CFE6FA" }}>
            <div className="text-base font-semibold" style={{ fontFamily: "'Fraunces', serif", color: "#002060" }}>{s.value}</div>
            <div className="text-[10px] text-[#7C8896]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Stamps — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#7C8896] mb-2"
            style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Regions</div>
          {regionEntries.length === 0
            ? <p className="text-xs text-[#7C8896]">No stamps yet</p>
            : <div className="flex flex-wrap gap-1.5">
              {regionEntries.map(([r, c]) => (
                <StampChip key={r} label={r} count={c}
                  color={REGION_COLOR[r]?.bg || "#002060"}
                  textColor={REGION_COLOR[r]?.text || "#fff"} />
              ))}
            </div>
          }
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#7C8896] mb-2"
            style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Offices</div>
          {officeEntries.length === 0
            ? <p className="text-xs text-[#7C8896]">No stamps yet</p>
            : <div className="flex flex-wrap gap-1.5">
              {officeEntries.map(([o, c]) => {
                const officeCountry = OFFICES.find(x => x.office === o)?.country;
                return <StampChip key={o} label={o} count={c} color="#002060" textColor="#fff" country={officeCountry} />;
              })}
            </div>
          }
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#7C8896] mb-2"
            style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Badges</div>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_BADGES.map((b, i) => {
              const earned = user.badges.includes(BADGE_FULL_NAMES[i]);
              const Icon = b.icon;
              return (
                <div key={b.name}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs relative group cursor-default"
                  title={b.desc}
                  style={{
                    backgroundColor: earned ? "#EAF5FF" : "#F5FAFF",
                    color: earned ? "#002060" : "#A0AABB",
                    border: `1px solid ${earned ? "#89D1FF" : "#E0EAF5"}`,
                  }}>
                  <Icon size={11} color={earned ? "#DF1278" : "#7C8896"} />
                  <span className="truncate">{b.name}</span>
                  {/* Hover tooltip */}
                  <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg px-2.5 py-2 text-[10px] leading-snug pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
                    style={{ backgroundColor: "#000d24", color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>
                    {b.desc}
                    <div className="absolute top-full left-4 border-4 border-transparent" style={{ borderTopColor: "#000d24" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Center panel: Coffee Match ---------------------- */

/* Slot machine keyframes — injected once */
const SLOT_STYLES = `
@keyframes bounce {
  0%   { transform: translateY(0); }
  100% { transform: translateY(-4px); }
}
@keyframes slotSpin {
  0%   { transform: translateY(-280%) scaleY(1.1); opacity: 0;   filter: blur(4px); }
  18%  { transform: translateY(-160%) scaleY(1.05); opacity: 0.4; filter: blur(3px); }
  36%  { transform: translateY(-70%)  scaleY(1.02); opacity: 0.7; filter: blur(1px); }
  55%  { transform: translateY(10px)  scaleY(0.97); opacity: 1;   filter: blur(0);   }
  68%  { transform: translateY(-6px)  scaleY(1.01); opacity: 1;   filter: blur(0);   }
  80%  { transform: translateY(3px)   scaleY(0.99); opacity: 1;   filter: blur(0);   }
  90%  { transform: translateY(-1px)  scaleY(1);    opacity: 1;   filter: blur(0);   }
  100% { transform: translateY(0)     scaleY(1);    opacity: 1;   filter: blur(0);   }
}
@keyframes reelBlur {
  0%   { transform: translateY(0%);    opacity: 1; }
  100% { transform: translateY(-320%); opacity: 0; }
}
@keyframes spinBtnRotate {
  0%   { transform: rotate(0deg)   scale(1); }
  30%  { transform: rotate(-200deg) scale(0.88); }
  60%  { transform: rotate(-340deg) scale(1.05); }
  80%  { transform: rotate(-355deg) scale(0.97); }
  100% { transform: rotate(-360deg) scale(1); }
}
@keyframes spinBtnShake {
  0%,100% { transform: rotate(0deg); }
  25%     { transform: rotate(-8deg); }
  50%     { transform: rotate(8deg); }
  75%     { transform: rotate(-5deg); }
}
@keyframes spinBtnPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(223,18,120,0.5), 0 4px 14px rgba(223,18,120,0.35); }
  60%     { box-shadow: 0 0 0 8px rgba(223,18,120,0), 0 4px 18px rgba(223,18,120,0.5); }
}
@keyframes notifSlideIn {
  0%   { transform: translateY(-100%); opacity: 0; }
  60%  { transform: translateY(4px);   opacity: 1; }
  100% { transform: translateY(0);     opacity: 1; }
}
@keyframes notifSlideOut {
  0%   { transform: translateY(0);     opacity: 1; }
  100% { transform: translateY(-120%); opacity: 0; }
}
@keyframes shimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}
.slot-card-enter   { animation: slotSpin 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }
.spin-btn-go       { animation: spinBtnRotate 0.65s cubic-bezier(0.22,1,0.36,1) forwards; }
.spin-btn-shake    { animation: spinBtnShake 0.4s ease-in-out forwards; }
.spin-btn-pulse    { animation: spinBtnPulse 1.8s ease-in-out infinite; }
.notif-enter       { animation: notifSlideIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards; }
.notif-exit        { animation: notifSlideOut 0.3s ease-in forwards; }
@keyframes stampPress {
  0%   { transform: translateY(-60px) rotate(-12deg) scale(1.3); opacity: 0; }
  45%  { transform: translateY(0px)   rotate(-12deg) scale(0.92); opacity: 1; }
  60%  { transform: translateY(-6px)  rotate(-12deg) scale(1.04); opacity: 1; }
  100% { transform: translateY(0px)   rotate(-12deg) scale(1);    opacity: 1; }
}
@keyframes stampFade {
  0%,60% { opacity: 1; }
  100%    { opacity: 0; }
}
@keyframes confettiFall {
  0%   { transform: translateY(-20px) rotate(0deg);    opacity: 1; }
  100% { transform: translateY(110vh) rotate(720deg);  opacity: 0; }
}
.stamp-press { animation: stampPress 0.45s cubic-bezier(0.22,1,0.36,1) forwards; }
.stamp-fade  { animation: stampFade 2s ease-in forwards; }
`;


function useSlotStyles() {
  React.useEffect(() => {
    const id = "slot-styles";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id; s.textContent = SLOT_STYLES;
    document.head.appendChild(s);
  }, []);
}

function MatchPanel({ users, matches, currentUser, onAccept, onReshuffle, reshufflesLeft, matchesLeft }) {
  useSlotStyles();
  const [suggestion, setSuggestion] = useState(() => suggestMatch(users, matches, currentUser));
  const [excluded, setExcluded] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [spinKey, setSpinKey] = useState(0);
  const [leverActive, setLeverActive] = useState(false);
  const [leverShaking, setLeverShaking] = useState(false);
  const [icebreaker, setIcebreaker] = useState(null);
  const [icebreakerLoading, setIcebreakerLoading] = useState(false);
  const [icebreakerError, setIcebreakerError] = useState(false);
  const limitReached = matchesLeft <= 0;
  const newRegion = suggestion && !currentUser.collectedRegions[suggestion.region];
  const newOffice  = suggestion && !currentUser.collectedOffices[suggestion.office];
  const used = MAX_MATCHES_PER_DAY - matchesLeft;

  React.useEffect(() => {
    if (!suggestion) { setIcebreaker(null); return; }
    setIcebreaker(null);
    setIcebreakerError(false);
    setIcebreakerLoading(true);

    const prompt = `You are generating a coffee chat icebreaker for SAP early talent. Generate ONE curious question (max 22 words) for someone meeting a ${suggestion.role} based in ${suggestion.office}, ${suggestion.country} (${suggestion.region} region). Their interests: ${suggestion.interests.join(", ")}. Weave their role and location together naturally. Also a 2-3 word tag like "Day-to-day", "Local insight", "Career path". Respond ONLY with valid JSON, no markdown: {"prompt":"...","tag":"..."}`;

    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        const text = (data?.content || [])
          .filter(b => b.type === "text")
          .map(b => b.text)
          .join("")
          .replace(/```json|```/g, "")
          .trim();
        const parsed = JSON.parse(text);
        if (parsed.prompt) setIcebreaker(parsed);
        else throw new Error("bad shape");
      })
      .catch(() => setIcebreakerError(true))
      .finally(() => setIcebreakerLoading(false));
  }, [suggestion?.id]);

  function triggerSpin(newSuggestion) {
    setSpinning(true);
    setLeverActive(true);
    setTimeout(() => setLeverActive(false), 680);
    setTimeout(() => {
      setSuggestion(newSuggestion);
      setSpinKey(k => k + 1);
      setSpinning(false);
    }, 180);
  }

  function handleReshuffle() {
    if (spinning) return;
    if (reshufflesLeft <= 0 || !suggestion) {
      setLeverShaking(true);
      setTimeout(() => setLeverShaking(false), 450);
      return;
    }
    const next = [...excluded, suggestion.id];
    setExcluded(next);
    triggerSpin(suggestMatch(users, matches, currentUser, next));
    onReshuffle();
  }

  function handleAccept() {
    if (!suggestion || limitReached || spinning) return;
    onAccept(suggestion);
    setExcluded([]);
    triggerSpin(suggestMatch(users, matches, currentUser, []));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: "#fff" }}>
      <PanelHeader icon={Coffee}>Coffee Match</PanelHeader>

      {/* Machine body */}
      <div className="flex-1 flex flex-col items-center justify-start px-5 py-5 gap-4 overflow-y-auto">

        {/* Quota pips */}
        <div className="w-full flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="flex gap-1.5">
              {Array.from({ length: MAX_MATCHES_PER_DAY }).map((_, i) => (
                <div key={i} className="h-2 flex-1 rounded-full transition-all duration-300"
                  style={{ backgroundColor: i < used ? "#1B90FF" : "#D1EFFF" }} />
              ))}
            </div>
            <div className="text-[10px] text-[#7C8896] mt-1 font-mono">{used}/{MAX_MATCHES_PER_DAY} matches today</div>
          </div>
          <div className="text-[10px] text-[#7C8896] font-mono shrink-0">
            {reshufflesLeft} reshuffle{reshufflesLeft === 1 ? "" : "s"}
          </div>
        </div>

        {/* Slot machine frame */}
        <div className="w-full rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(160deg, #001642 0%, #002060 60%, #0A3D8F 100%)",
            boxShadow: "0 8px 32px rgba(0,32,96,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
            border: "2px solid #0A3D8F",
          }}>

          {/* Machine top label */}
          <div className="flex items-center justify-center gap-2 py-2.5 border-b"
            style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <Coffee size={13} color="#89D1FF" />
            <span className="text-xs font-semibold tracking-[0.2em] uppercase"
              style={{ color: "#89D1FF", fontFamily: "'IBM Plex Mono', monospace" }}>
              SAP Next Gen Matcher
            </span>
            <Coffee size={13} color="#89D1FF" />
          </div>

          {/* Reel window */}
          <div className="mx-4 my-3 rounded-xl overflow-hidden relative"
            style={{
              backgroundColor: "#EAF5FF",
              border: "2px solid rgba(255,255,255,0.12)",
              boxShadow: "inset 0 4px 16px rgba(0,32,96,0.18)",
              minHeight: 180,
            }}>

            {/* Top fade — reel illusion */}
            <div className="absolute top-0 left-0 right-0 h-8 z-10 pointer-events-none"
              style={{ background: "linear-gradient(to bottom, rgba(234,245,255,0.95), transparent)" }} />
            <div className="absolute bottom-0 left-0 right-0 h-8 z-10 pointer-events-none"
              style={{ background: "linear-gradient(to top, rgba(234,245,255,0.95), transparent)" }} />

            {limitReached ? (
              <div className="flex flex-col items-center text-center px-5 py-6 gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mb-1"
                  style={{ backgroundColor: "#EAF5FF" }}>
                  <Coffee size={22} color="#1B90FF" />
                </div>
                <div className="text-sm font-semibold text-[#002060]">You're all matched up for today!</div>
                <div className="text-xs text-[#445063] leading-relaxed">
                  You've connected with {MAX_MATCHES_PER_DAY} people today — great work. Now head to your
                  <span className="font-semibold text-[#1B90FF]"> Active Matches</span> and schedule those chats. Every confirmed chat earns a stamp.
                </div>
                <div className="text-[10px] text-[#7C8896] mt-1">More spins available tomorrow.</div>
              </div>
            ) : !suggestion ? (
              <div className="flex flex-col items-center justify-center h-44 gap-2">
                <Users size={24} color="#7C8896" />
                <div className="text-[10px] text-[#7C8896] text-center px-4">
                  No colleagues to match with yet.<br />You'll see suggestions once others join.
                </div>
              </div>
            ) : (
              <div key={spinKey} className={spinning ? "" : "slot-card-enter"}>
                {/* Card content */}
                <div className="p-4 relative overflow-hidden">
                  <div className="flex items-start gap-3 mb-3 relative">
                    <Avatar name={suggestion.name} email={suggestion.email} size={48} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span className="font-semibold text-sm" style={{ color: "#002060", fontFamily: "'Fraunces', serif" }}>
                          {suggestion.name}
                        </span>
                      </div>
                      <div className="text-xs text-[#5A6472] mb-2">{suggestion.role}</div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-[#5A6472]">
                          <MapPin size={11} />
                          {suggestion.office}, {suggestion.country}
                          <span className="text-base leading-none">{COUNTRY_EMOJI[suggestion.country] || ""}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <Globe2 size={11} color="#5A6472" />
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: REGION_COLOR[suggestion.region]?.bg, color: REGION_COLOR[suggestion.region]?.text }}>
                            {suggestion.region}
                          </span>
                          <Clock size={11} color="#5A6472" />
                          <span className="text-xs text-[#5A6472]">{suggestion.timezone}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tags row */}
                  <div className="flex flex-wrap gap-1 mb-2 relative">
                    {newRegion && <Pill color="#DF1278">✦ New region</Pill>}
                    {newOffice  && <Pill color="#1B90FF">✦ New office</Pill>}
                    {suggestion.interests.slice(0, 3).map(i => (
                      <span key={i} className="text-[10px] rounded-full px-2 py-0.5"
                        style={{ backgroundColor: "#D1EFFF", color: "#002060" }}>{i}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Lever + buttons row */}
          <div className="flex items-center justify-between px-4 pb-4 gap-3">

            {/* Accept button */}
            <button
              onClick={handleAccept}
              disabled={!suggestion || limitReached || spinning}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#1B90FF", color: "#fff", boxShadow: "0 2px 8px rgba(27,144,255,0.4)" }}>
              <Check size={15} /> Accept match
            </button>

            {/* Spin button */}
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div className="text-[9px] font-mono uppercase tracking-widest"
                style={{ color: "rgba(137,209,255,0.7)" }}>spin</div>

              <button
                onClick={handleReshuffle}
                disabled={spinning}
                className={`relative flex items-center justify-center rounded-full transition-all disabled:cursor-not-allowed ${leverActive ? "spin-btn-go" : leverShaking ? "spin-btn-shake" : reshufflesLeft > 0 ? "spin-btn-pulse" : ""}`}
                title={reshufflesLeft > 0 ? "Spin for a new match" : "No spins left"}
                style={{
                  width: 52, height: 52,
                  backgroundColor: reshufflesLeft > 0 ? "#DF1278" : "#2A2A3A",
                  boxShadow: reshufflesLeft > 0
                    ? "0 4px 14px rgba(223,18,120,0.4), inset 0 1px 0 rgba(255,255,255,0.2)"
                    : "inset 0 2px 4px rgba(0,0,0,0.4)",
                  border: `2px solid ${reshufflesLeft > 0 ? "rgba(255,111,173,0.6)" : "rgba(255,255,255,0.08)"}`,
                }}>
                <Shuffle size={22} color={reshufflesLeft > 0 ? "#fff" : "#555"} />
                <div style={{
                  position: "absolute", top: 5, left: 9,
                  width: 16, height: 9, borderRadius: "50%",
                  backgroundColor: "rgba(255,255,255,0.2)",
                  pointerEvents: "none",
                }} />
              </button>

              <div className="flex gap-1">
                {Array.from({ length: MAX_RESHUFFLES_PER_DAY }).map((_, i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                    style={{ backgroundColor: i < reshufflesLeft ? "#DF1278" : "rgba(255,255,255,0.15)" }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* AI Icebreaker */}
        {suggestion && (
          <div className="w-full rounded-2xl px-4 py-3"
            style={{ backgroundColor: "#EAF5FF", border: "1px solid #CFE6FA", minHeight: 72 }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Sparkles size={12} color="#1B90FF" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "#1B90FF", fontFamily: "'IBM Plex Mono', monospace" }}>
                  AI Icebreaker · {suggestion.role}
                </span>
              </div>
              {!icebreakerLoading && icebreaker?.tag && (
                <span className="text-[10px] rounded-full px-2 py-0.5"
                  style={{ backgroundColor: "#D1EFFF", color: "#002060" }}>
                  {icebreaker.tag}
                </span>
              )}
            </div>
            {icebreakerLoading ? (
              <div className="flex items-center gap-2 py-1">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: "#1B90FF", opacity: 0.5,
                        animation: `bounce 1s ease-in-out ${i * 0.18}s infinite alternate` }} />
                  ))}
                </div>
                <span className="text-xs text-[#7C8896]">Generating for {suggestion.role} in {suggestion.office}…</span>
              </div>
            ) : icebreakerError ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#DF1278]">
                  {import.meta.env.VITE_ANTHROPIC_API_KEY ? "Couldn't reach AI — check your connection." : "AI icebreakers unavailable (no API key configured)."}
                </span>
                <button onClick={() => {
                  setIcebreakerError(false);
                  setIcebreakerLoading(true);
                  const prompt = `Generate ONE coffee chat icebreaker question (max 22 words) for someone meeting a ${suggestion.role} in ${suggestion.office}, ${suggestion.country}. Respond ONLY with valid JSON: {"prompt":"...","tag":"..."}`;
                  fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY || "",
                      "anthropic-version": "2023-06-01",
                      "anthropic-dangerous-direct-browser-access": "true",
                    },
                    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
                  })
                    .then(r => r.json())
                    .then(data => {
                      const text = (data?.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").replace(/```json|```/g,"").trim();
                      const p = JSON.parse(text);
                      if (p.prompt) setIcebreaker(p); else throw new Error();
                    })
                    .catch(() => setIcebreakerError(true))
                    .finally(() => setIcebreakerLoading(false));
                }}
                  className="text-xs font-medium rounded-full px-2.5 py-1"
                  style={{ backgroundColor: "#1B90FF", color: "#fff" }}>
                  Retry
                </button>
              </div>
            ) : (
              <p className="text-sm leading-snug" style={{ color: "#002060" }}>
                {icebreaker?.prompt}
              </p>
            )}
          </div>
        )}

        {/* Coin tray label */}
        <div className="text-[10px] text-[#7C8896] font-mono tracking-wider uppercase text-center">
          Spin to reshuffle · Accept to match
        </div>

      </div>
    </div>
  );
}

/* ---------------------- Right panel: Active Matches ---------------------- */

function MatchesPanel({ matches, users, currentUser, onConfirm, onRemove, onAcknowledge }) {
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [infoOpenId, setInfoOpenId] = useState(null);
  const [icebreakers, setIcebreakers] = useState({});
  const [tzOpenId, setTzOpenId] = useState(null);
  const usersById = Object.fromEntries(users.map(u => [u.id, u]));

  // Matches expiring within 2 days that haven't been confirmed
  const urgentMatches = matches.filter(m =>
    (m.userAId === currentUser.id || m.userBId === currentUser.id) &&
    !m.removed && m.status === "active" &&
    Math.ceil((m.expiresAt - Date.now()) / 86400000) <= 2
  );

  function generateInvite(m, other, icebreaker) {
    const myName = currentUser.name;
    const theirName = other.name;
    const subject = `☕ Coffee Chat: ${myName} × ${theirName} | SAP Next Gen Connections Passport`;
    const teamsLink = `https://teams.microsoft.com/l/meeting/new?subject=${encodeURIComponent(subject)}&attendees=${encodeURIComponent(other.name)}`;
    const body = `Hi ${theirName.split(" ")[0]},

I'd love to connect for a quick coffee chat as part of the SAP Next Gen Connections Passport program! 🌍

📋 Suggested agenda (30 min):
  • Quick intros — role, office, what you're working on
  • ${icebreaker?.prompt || "Share something about your experience at SAP so far"}
  • Wrap up & swap any tips or resources

📍 Location: Microsoft Teams (link below)
⏱ Duration: 30 minutes
🌐 Your timezone: ${other.timezone} | Mine: ${currentUser.timezone || "—"}

Once we've had our chat, please remember to confirm in the Connections Passport app so we both earn our stamps! 🎖️

Looking forward to connecting,
${myName}

—
🔗 Book via Teams: ${teamsLink}
📌 Program: SAP Next Gen Connections Passport`;

    return { subject, body, teamsLink };
  }

  function fetchIcebreaker(matchId, other) {
    setIcebreakers(prev => ({ ...prev, [matchId]: { loading: true, prompt: null, tag: null, error: false } }));
    const prompt = `Generate ONE coffee chat icebreaker question (max 22 words) for someone meeting a ${other.role} based in ${other.office}, ${other.country}. Their interests: ${other.interests.join(", ")}. Make it curious and role/location specific. Respond ONLY with valid JSON: {"prompt":"...","tag":"..."}`;
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        const text = (data?.content || []).filter(b => b.type === "text").map(b => b.text).join("").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(text);
        if (parsed.prompt) setIcebreakers(prev => ({ ...prev, [matchId]: { loading: false, prompt: parsed.prompt, tag: parsed.tag, error: false } }));
        else throw new Error();
      })
      .catch(() => setIcebreakers(prev => ({ ...prev, [matchId]: { loading: false, prompt: null, tag: null, error: true } })));
  }

  const myMatches = matches.filter(m =>
    (m.userAId === currentUser.id || m.userBId === currentUser.id) && !m.removed
  );

  const groups = [
    { key: "active",               label: "Active",    color: "#1B90FF" },
    { key: "pending_confirmation",  label: "Pending",   color: "#DF1278" },
    { key: "completed",            label: "Completed", color: "#002060" },
    { key: "expired",              label: "Expired",   color: "#7C8896" },
  ];

  function MatchRow({ m }) {
    const otherId = m.userAId === currentUser.id ? m.userBId : m.userAId;
    const other = usersById[otherId];
    const isUserA = m.userAId === currentUser.id;
    const myConfirmed = isUserA ? m.confirmedA : m.confirmedB;
    const daysLeft = Math.max(0, Math.ceil((m.expiresAt - Date.now()) / 86400000));
    const isRemoving = confirmRemoveId === m.id;
    const showingInfo = infoOpenId === m.id;
    const infoRef = React.useRef(null);
    const icebreakerState = icebreakers[m.id];
    const [icebreakerOpen, setIcebreakerOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showInvite, setShowInvite] = useState(false);
    const [notesOpen, setNotesOpen] = useState(false);
    const [noteText, setNoteText] = useState("");
    const isUrgent = m.status === "active" && daysLeft <= 2;
    const tzOpen = tzOpenId === m.id;

    // Timezone data — DST-aware via IANA names
    const myIANA = getIANA(currentUser.office, currentUser.country);
    const theirIANA = getIANA(other.office, other.country);
    const overlapGrid = getOverlapGrid(myIANA, theirIANA);
    const overlapHours = overlapGrid.filter(h => h.both).length;
    const myTimeStr = fmtTimeInTz(myIANA);
    const theirTimeStr = fmtTimeInTz(theirIANA);

    return (
      <div className="border-b" style={{ borderColor: "#EAF5FF" }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <Avatar name={other.name} email={other.email} size={32} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium truncate" style={{ color: "#002060" }}>{other.name}</span>
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: isUrgent ? "#DF1278" : "#7C8896" }}>
              {other.office}
              {m.status === "active" && (
                <span>
                  {isUrgent ? ` · ⚠️ ${daysLeft}d left — schedule soon!` : ` · ${daysLeft}d left`}
                </span>
              )}
              {m.status === "pending_confirmation" && (myConfirmed ? " · waiting on them" : " · they confirmed")}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Inline info icon with portal tooltip */}
            <div className="relative">
              <button
                ref={infoRef}
                onClick={() => setInfoOpenId(showingInfo ? null : m.id)}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors"
                style={{ backgroundColor: showingInfo ? "#1B90FF" : "#D1EFFF", color: showingInfo ? "#fff" : "#002060" }}
                title="How this works">
                i
              </button>
              <FixedTooltip anchorRef={infoRef} open={showingInfo}>
                <div className="w-56 rounded-xl p-3 text-[11px] leading-relaxed"
                  style={{ backgroundColor: "#002060", color: "#fff", boxShadow: "0 8px 24px rgba(0,32,96,0.5)" }}>
                  {m.status === "active" && <>
                    <div className="font-semibold mb-1.5 text-[#89D1FF]">How it works</div>
                    <div className="space-y-1">
                      <div className="flex gap-1.5"><span>①</span><span>Schedule a meeting via calendar or Teams.</span></div>
                      <div className="flex gap-1.5"><span>②</span><span>After your chat, click <span className="font-semibold text-[#DF1278]">We met</span>.</span></div>
                      <div className="flex gap-1.5"><span>③</span><span>Both must confirm to earn a passport stamp!</span></div>
                    </div>
                  </>}
                  {m.status === "pending_confirmation" && <>
                    <div className="font-semibold mb-1.5 text-[#DF1278]">Pending confirmation</div>
                    <p>{myConfirmed
                      ? `You've confirmed — waiting for ${other.name.split(" ")[0]} to do the same. Once they confirm, you'll both earn a passport stamp!`
                      : `${other.name.split(" ")[0]} has confirmed your chat. Click "We met" to confirm on your end and unlock your passport stamp!`
                    }</p>
                  </>}
                  {m.status === "completed" && <>
                    <div className="font-semibold mb-1.5" style={{ color: "#89D1FF" }}>🎉 Chat completed!</div>
                    <p>Congratulations — you and {other.name.split(" ")[0]} both confirmed this chat. Check your passport for your new stamp from <span className="font-semibold">{other.office}</span>!</p>
                  </>}
                  {m.status === "expired" && <>
                    <div className="font-semibold mb-1.5 text-[#7C8896]">Match expired</div>
                    <p>This match wasn't confirmed within 7 days. No stamp was awarded — but you can always find a new match!</p>
                  </>}
                </div>
              </FixedTooltip>
            </div>

            {(m.status === "active" || m.status === "pending_confirmation") && !myConfirmed && (
              <Btn variant="magenta" sm onClick={() => onConfirm(m.id)}>We met</Btn>
            )}
            {m.status === "completed" && <Check size={14} color="#002060" />}
            {m.status === "expired" && <Hourglass size={14} color="#7C8896" />}

            <button
              onClick={() => setConfirmRemoveId(isRemoving ? null : m.id)}
              className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
              style={{ color: isRemoving ? "#DF1278" : "#7C8896", backgroundColor: isRemoving ? "#FFF0F5" : "transparent" }}
              title="Remove match">
              <X size={13} />
            </button>
          </div>
        </div>

        {isRemoving && (
          <div className="mx-4 mb-3 px-3 py-2.5 rounded-xl flex items-center justify-between gap-3"
            style={{ backgroundColor: "#FFF0F5", border: "1px solid #FFB3D1" }}>
            <span className="text-xs text-[#002060]">Remove this match?</span>
            <div className="flex gap-2">
              <Btn sm variant="ghost" onClick={() => setConfirmRemoveId(null)}>Cancel</Btn>
              <Btn sm variant="magenta" onClick={() => { onRemove(m.id); setConfirmRemoveId(null); }}>Remove</Btn>
            </div>
          </div>
        )}

        {/* Icebreaker section — active matches only */}
        {m.status === "active" && (
          <div className="mx-4 mb-3">
            {!icebreakerOpen ? (
              <button
                onClick={() => {
                  setIcebreakerOpen(true);
                  if (!icebreakerState) fetchIcebreaker(m.id, other);
                }}
                className="flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1 transition-colors"
                style={{ backgroundColor: "#EAF5FF", color: "#1B90FF", border: "1px solid #D1EFFF" }}>
                <Sparkles size={10} /> Get icebreaker
              </button>
            ) : (
              <div className="rounded-xl px-3 py-2.5"
                style={{ backgroundColor: "#EAF5FF", border: "1px solid #D1EFFF" }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <Sparkles size={10} color="#1B90FF" />
                    <span className="text-[9px] font-semibold uppercase tracking-widest"
                      style={{ color: "#1B90FF", fontFamily: "'IBM Plex Mono', monospace" }}>
                      AI Icebreaker
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!icebreakerState?.loading && icebreakerState?.tag && (
                      <span className="text-[9px] rounded-full px-1.5 py-0.5"
                        style={{ backgroundColor: "#D1EFFF", color: "#002060" }}>
                        {icebreakerState.tag}
                      </span>
                    )}
                    <button onClick={() => setIcebreakerOpen(false)}
                      className="text-[#7C8896]"><X size={11} /></button>
                  </div>
                </div>
                {icebreakerState?.loading && (
                  <div className="flex items-center gap-1.5">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: "#1B90FF", opacity: 0.5,
                          animation: `bounce 1s ease-in-out ${i*0.18}s infinite alternate` }} />
                    ))}
                    <span className="text-[10px] text-[#7C8896]">Generating…</span>
                  </div>
                )}
                {icebreakerState?.error && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: "#DF1278" }}>
                      {import.meta.env.VITE_ANTHROPIC_API_KEY ? "Couldn't reach AI — check connection." : "AI unavailable (no API key)."}
                    </span>
                    <button onClick={() => fetchIcebreaker(m.id, other)}
                      className="text-[10px] font-medium rounded-full px-2 py-0.5"
                      style={{ backgroundColor: "#1B90FF", color: "#fff" }}>Retry</button>
                  </div>
                )}
                {icebreakerState?.prompt && (
                  <p className="text-xs leading-snug" style={{ color: "#002060" }}>
                    {icebreakerState.prompt}
                  </p>
                )}\n              </div>
            )}
          </div>
        )}

        {/* Timezone + invite chips row — active matches only */}
        {m.status === "active" && (
          <div className="mx-4 mb-2 flex flex-wrap gap-2">
            <button
              onClick={() => setTzOpenId(tzOpen ? null : m.id)}
              className="flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1 transition-colors"
              style={{
                backgroundColor: tzOpen ? "#002060" : "#F5FAFF",
                color: tzOpen ? "#fff" : "#445063",
                border: "1px solid #CFE6FA",
              }}>
              🕐 {overlapHours > 0 ? `${overlapHours}h friendly hours` : "No overlap"}
            </button>
            {!showInvite && (
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1 transition-colors"
                style={{ backgroundColor: "#F5FAFF", color: "#445063", border: "1px solid #CFE6FA" }}>
                📅 Copy meeting invite
              </button>
            )}
          </div>
        )}

        {/* Timezone overlap panel */}
        {m.status === "active" && tzOpen && (
          <div className="mx-4 mb-3 rounded-xl p-3 space-y-3"
            style={{ backgroundColor: "#F5FAFF", border: "1px solid #CFE6FA" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#445063]"
                style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                Timezone overlap
              </span>
              <button onClick={() => setTzOpenId(null)} style={{ color: "#7C8896" }}><X size={11} /></button>
            </div>

            {/* Current times */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "You", name: currentUser.name.split(" ")[0], tz: myIANA.split("/")[1]?.replace(/_/g," ") || myIANA, timeStr: myTimeStr, color: "#1B90FF" },
                { label: other.name.split(" ")[0], name: other.office, tz: theirIANA.split("/")[1]?.replace(/_/g," ") || theirIANA, timeStr: theirTimeStr, color: "#DF1278" },
              ].map(p => (
                <div key={p.label} className="rounded-lg p-2.5 text-center"
                  style={{ backgroundColor: "#fff", border: `1px solid ${p.color}22` }}>
                  <div className="text-[9px] text-[#7C8896] mb-0.5">{p.label} · {p.name}</div>
                  <div className="text-base font-semibold" style={{ color: p.color, fontFamily: "'Fraunces', serif" }}>
                    {p.timeStr}
                  </div>
                  <div className="text-[9px] text-[#7C8896] mt-0.5">{p.tz}</div>
                </div>
              ))}
            </div>

            {/* 24-hour overlap grid */}
            <div>
              <div className="text-[9px] text-[#7C8896] mb-1.5">
                {overlapHours > 0
                  ? `${overlapHours}h of friendly hours overlap (9–5 local time for both)`
                  : "No friendly hours overlap — consider an early/late slot or async"}
              </div>
              <div className="flex gap-px rounded overflow-hidden" style={{ height: 14 }}>
                {overlapGrid.map((h, i) => (
                  <div key={i} className="flex-1" title={`${i}:00 UTC`}
                    style={{
                      backgroundColor: h.both ? "#1B90FF"
                        : h.a1 ? "#89D1FF"
                        : h.a2 ? "#FFB3D1"
                        : "#EAF5FF",
                    }} />
                ))}
              </div>
              <div className="flex justify-between text-[8px] text-[#7C8896] mt-0.5">
                <span>0:00 UTC</span><span>12:00</span><span>23:00</span>
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {[
                  { color: "#1B90FF", label: "Ideal time (both)" },
                  { color: "#89D1FF", label: "Your friendly hours" },
                  { color: "#FFB3D1", label: `${other.name.split(" ")[0]}'s friendly hours` },
                  { color: "#EAF5FF", label: "Outside friendly hours", border: true },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: s.color, border: s.border ? "1px solid #CFE6FA" : "none" }} />
                    <span className="text-[8px] text-[#7C8896]">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Meeting invite section — active matches only */}
        {m.status === "active" && showInvite && (
          <div className="mx-4 mb-3">
              <div className="rounded-xl p-3 space-y-2.5"
                style={{ backgroundColor: "#F5FAFF", border: "1px solid #CFE6FA" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#445063]"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    Meeting invite
                  </span>
                  <button onClick={() => setShowInvite(false)} style={{ color: "#7C8896" }}><X size={11} /></button>
                </div>

                {/* Preview */}
                <div className="rounded-lg p-2.5 text-[10px] leading-relaxed font-mono overflow-y-auto"
                  style={{ backgroundColor: "#fff", border: "1px solid #EAF5FF", maxHeight: 120, color: "#445063", whiteSpace: "pre-wrap" }}>
                  {`Subject: ☕ Coffee Chat: ${currentUser.name} × ${other.name} | SAP Next Gen Connections Passport\n\nHi ${other.name.split(" ")[0]}, I'd love to connect for a 30-min coffee chat via the SAP Next Gen Connections Passport! Topic: ${icebreakerState?.prompt || "Share your SAP experience so far."}  Please confirm in the app after we chat to earn our stamps! 🎖️`}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const { subject, body } = generateInvite(m, other, icebreakerState);
                      navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
                        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); })
                        .catch(() => {});
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition-all"
                    style={{
                      backgroundColor: copied ? "#EAF5FF" : "#002060",
                      color: copied ? "#1B90FF" : "#fff",
                    }}>
                    {copied ? <><Check size={12} /> Copied!</> : <>📋 Copy invite</>}
                  </button>
                  <button
                    onClick={() => window.open(generateInvite(m, other, icebreakerState).teamsLink, "_blank")}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold"
                    style={{ backgroundColor: "#5059C9", color: "#fff" }}>
                    🟦 Open in Teams
                  </button>
                </div>
                <p className="text-[9px] text-[#7C8896] text-center">
                  After your chat, click "We met" on this match to confirm and earn your passport stamp.
                </p>
              </div>
          </div>
        )}

        {/* Post-chat notes — completed matches only */}
        {m.status === "completed" && (
          <div className="mx-4 mb-3">
            {!notesOpen && !noteText ? (
              <button
                onClick={() => setNotesOpen(true)}
                className="flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1"
                style={{ backgroundColor: "#F5FAFF", color: "#445063", border: "1px solid #CFE6FA" }}>
                📝 Add chat notes
              </button>
            ) : (
              <div className="rounded-xl p-3 space-y-2"
                style={{ backgroundColor: "#F5FAFF", border: "1px solid #CFE6FA" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#445063]"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    📝 Your private notes
                  </span>
                  {noteText && !notesOpen && (
                    <button onClick={() => setNotesOpen(true)}
                      className="text-[10px] font-medium" style={{ color: "#1B90FF" }}>Edit</button>
                  )}
                  {notesOpen && (
                    <button onClick={() => setNotesOpen(false)} style={{ color: "#7C8896" }}><X size={11} /></button>
                  )}
                </div>
                {notesOpen ? (
                  <>
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder={`What did you talk about with ${other.name.split(" ")[0]}? Any follow-up ideas or resources to share?`}
                      className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none"
                      style={{ backgroundColor: "#fff", border: "1px solid #EAF5FF", color: "#002060", minHeight: 80 }}
                    />
                    <button
                      onClick={() => setNotesOpen(false)}
                      className="text-[11px] font-semibold rounded-lg px-3 py-1.5"
                      style={{ backgroundColor: "#002060", color: "#fff" }}>
                      Save notes
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-[#445063] leading-relaxed whitespace-pre-wrap">{noteText}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PanelHeader icon={Users}>Matches</PanelHeader>

      {/* Expiry reminder banner */}
      {urgentMatches.length > 0 && (
        <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl flex items-center gap-2.5"
          style={{ backgroundColor: "#FFF8E8", border: "1px solid #FFD87A" }}>
          <span className="text-base shrink-0">⏰</span>
          <p className="text-[11px] leading-snug" style={{ color: "#6B4C00" }}>
            <span className="font-semibold">{urgentMatches.length} match{urgentMatches.length > 1 ? "es expire" : " expires"} in {urgentMatches.length === 1 ? `${Math.ceil((urgentMatches[0].expiresAt - Date.now()) / 86400000)}d` : "≤2 days"}.</span>
            {" "}Use the meeting invite below to schedule before time runs out.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {myMatches.length === 0 ? (
          <div className="p-6 text-center">
            <Coffee size={24} className="mx-auto mb-2" color="#7C8896" />
            <p className="text-xs text-[#7C8896]">No matches yet — accept one to start.</p>
          </div>
        ) : groups.map(g => {
          const inGroup = myMatches.filter(m => m.status === g.key);
          if (inGroup.length === 0) return null;
          return (
            <div key={g.key}>
              {/* Section label */}
              <div className="flex items-center gap-2 px-4 py-2 sticky top-0 z-10"
                style={{ backgroundColor: "#F5FAFF", borderBottom: "1px solid #EAF5FF" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                <span className="text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: g.color, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {g.label}
                </span>
                <span className="text-[10px] text-[#7C8896]">({inGroup.length})</span>
              </div>
              {inGroup.map(m => <MatchRow key={m.id} m={m} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------- Dedicated Passport Page ---------------------- */

function PassportPage({ user }) {
  const regionEntries = Object.entries(user.collectedRegions);
  const officeEntries = Object.entries(user.collectedOffices);
  const totalStamps = regionEntries.reduce((s,[,c])=>s+c,0) + officeEntries.reduce((s,[,c])=>s+c,0);

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#EAF5FF" }}>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Passport cover header */}
        <div className="rounded-3xl overflow-hidden" style={{
          background: "linear-gradient(135deg, #001642 0%, #002060 55%, #0A3D8F 100%)",
          boxShadow: "0 8px 40px rgba(0,32,96,0.3)",
        }}>
          <div className="px-8 py-6 flex items-center justify-between">
            <div>
              <div className="text-xs tracking-[0.2em] uppercase mb-2 font-medium"
                style={{ color: "#89D1FF", fontFamily: "'IBM Plex Mono', monospace" }}>
                SAP Next Gen · Digital Passport
              </div>
              <div className="text-2xl font-semibold text-white mb-1"
                style={{ fontFamily: "'Fraunces', serif" }}>
                {user.name}
              </div>
              <div className="text-sm text-white">{user.role} · {user.office}</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <span style={{ fontSize: 36, lineHeight: 1 }}>{COUNTRY_EMOJI[user.country] || "🌐"}</span>
              </div>
              <div className="text-[10px] font-mono text-white opacity-80">{user.country}</div>
            </div>
          </div>
          {/* Stats strip */}
          <div className="grid grid-cols-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            {[
              { label: "Chats", value: user.chatsCompleted },
              { label: "Regions", value: `${Object.keys(user.collectedRegions).length}/${REGIONS.length}` },
              { label: "Offices", value: Object.keys(user.collectedOffices).length },
              { label: "Stamps", value: totalStamps },
            ].map(s => (
              <div key={s.label} className="px-4 py-3 text-center border-r last:border-r-0"
                style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <div className="text-xl font-semibold text-white" style={{ fontFamily: "'Fraunces', serif" }}>{s.value}</div>
                <div className="text-[10px] text-white opacity-60">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Region stamps */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Globe2 size={15} color="#002060" />
            <h2 className="text-sm font-semibold text-[#002060]">Region Stamps</h2>
            <span className="text-xs text-[#7C8896]">— {regionEntries.length}/{REGIONS.length} regions collected</span>
          </div>
          {regionEntries.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-8 text-center" style={{ borderColor: "#CFE6FA" }}>
              <Globe2 size={24} className="mx-auto mb-2" color="#CFE6FA" />
              <p className="text-sm text-[#7C8896]">No region stamps yet — accept a coffee match to start collecting.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-5">
              {regionEntries.map(([region, count]) => (
                <div key={region} className="relative">
                  <StampCard
                    label={region} count={count}
                    color={REGION_COLOR[region]?.bg || "#002060"}
                    textColor={REGION_COLOR[region]?.text || "#fff"}
                    country={null}
                    sublabel={`${count} chat${count>1?"s":""}`}
                  />
                </div>
              ))}
              {/* Ghost stamps for uncollected regions */}
              {REGIONS.filter(r => !user.collectedRegions[r]).map(r => (
                <div key={r} className="flex flex-col items-center justify-center rounded-xl p-3 gap-2"
                  style={{ minWidth: 90, minHeight: 110, border: "2px dashed #CFE6FA", opacity: 0.4 }}>
                  <Globe2 size={24} color="#7C8896" />
                  <div className="text-[10px] text-[#7C8896] text-center uppercase tracking-wide"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Office stamps */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={15} color="#002060" />
            <h2 className="text-sm font-semibold text-[#002060]">Office Stamps</h2>
            <span className="text-xs text-[#7C8896]">— {officeEntries.length}/{OFFICES.length} offices collected</span>
          </div>
          {officeEntries.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-8 text-center" style={{ borderColor: "#CFE6FA" }}>
              <Building2 size={24} className="mx-auto mb-2" color="#CFE6FA" />
              <p className="text-sm text-[#7C8896]">No office stamps yet.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-5">
              {officeEntries.map(([office, count]) => {
                const officeData = OFFICES.find(o => o.office === office);
                return (
                  <div key={office} className="relative">
                    <StampCard
                      label={office}
                      count={count}
                      color="#002060"
                      textColor="#89D1FF"
                      country={officeData?.country}
                      sublabel={officeData?.country}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Milestone badges */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Award size={15} color="#002060" />
            <h2 className="text-sm font-semibold text-[#002060]">Milestone Badges</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ALL_BADGES.map((b, i) => {
              const earned = user.badges.includes(BADGE_FULL_NAMES[i]);
              const Icon = b.icon;
              return (
                <div key={b.name}
                  className="rounded-xl p-4 flex flex-col items-center text-center gap-2 relative group cursor-default"
                  style={{
                    backgroundColor: earned ? "#EAF5FF" : "#F5FAFF",
                    border: `1px solid ${earned ? "#89D1FF" : "#E0EAF5"}`,
                  }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: earned ? "#002060" : "#E8F3FC" }}>
                    <Icon size={18} color={earned ? "#89D1FF" : "#B0C4D8"} />
                  </div>
                  <span className="text-xs font-medium" style={{ color: earned ? "#002060" : "#A0AABB" }}>{BADGE_FULL_NAMES[i]}</span>
                  {earned && (
                    <span className="text-[9px] font-bold rounded-full px-2 py-0.5"
                      style={{ backgroundColor: "#DF1278", color: "#fff" }}>EARNED</span>
                  )}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 rounded-lg px-2.5 py-2 text-[10px] leading-snug pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 text-left"
                    style={{ backgroundColor: "#000d24", color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>
                    {b.desc}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent" style={{ borderTopColor: "#000d24" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

/* ---------------------- Admin overlay ---------------------- */

/* ---------------------- Signup Page ---------------------- */

const SIGNUP_STEPS = ["Privacy & Consent", "Profile", "Interests", "Review"];

function SignupPage({ onComplete, users, editMode = false, initialData = null, onPause, onDelete, isPaused, ssoUser }) {
  const [step, setStep] = useState(editMode ? 1 : 0);
  const [consent, setConsent] = useState({ dataProcessing: false, guidelines: false });

  // [SSO-INTEGRATION-POINT] Pre-fill name and office from SSO if available.
  // In production, ssoUser comes from the XSUAA token + SAP People Profile API.
  const ssoDefaults = ssoUser ? {
    name: ssoUser.name,
    office: ssoUser.office || OFFICES[0].office,
    country: ssoUser.country || OFFICES[0].country,
    region: OFFICES.find(o => o.office === (ssoUser.office || OFFICES[0].office))?.region || OFFICES[0].region,
  } : {};

  const [form, setForm] = useState(initialData || {
    name: ssoDefaults.name || "",
    role: ROLES[0],
    office: ssoDefaults.office || OFFICES[0].office,
    country: ssoDefaults.country || OFFICES[0].country,
    region: ssoDefaults.region || OFFICES[0].region,
    interests: [],
  });
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [otherInterest, setOtherInterest] = useState("");

  // Reset form if initialData changes (e.g. switching users)
  React.useEffect(() => {
    if (initialData) setForm(initialData);
  }, [JSON.stringify(initialData)]);

  function update(field, value) {
    if (field === "office") {
      const off = OFFICES.find(o => o.office === value);
      setForm(f => ({ ...f, office: value, country: off.country, region: off.region }));
    } else {
      setForm(f => ({ ...f, [field]: value }));
    }
  }

  function toggleInterest(item) {
    setForm(f => ({
      ...f,
      interests: f.interests.includes(item)
        ? f.interests.filter(i => i !== item)
        : f.interests.length < 10 ? [...f.interests, item] : f.interests,
    }));
  }

  const consentValid = consent.dataProcessing && consent.guidelines;
  const step1Valid = form.name.trim().length > 1;
  const step2Valid = form.interests.length >= 2;

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#EAF5FF" }}>
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ backgroundColor: "#002060" }}>
            <Coffee size={26} color="#DF1278" />
          </div>
          <h1 className="text-3xl font-semibold text-[#002060] mb-2"
            style={{ fontFamily: "'Fraunces', serif" }}>
            {editMode ? "Edit your profile" : "Apply to Connections Passport"}
          </h1>
          <p className="text-sm text-[#445063]">
            {editMode
              ? "Update your details and interests — changes apply to future matches."
              : "Connect with SAP Next Gen across SAP's global offices — one chat at a time."}
          </p>
        </div>

        {/* What's in it for me — shown on signup only, before steps begin */}
        {!editMode && (
          <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: "#002060" }}>
            <div className="text-xs font-semibold uppercase tracking-widest text-[#89D1FF] mb-3"
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              What's in it for you
            </div>
            <div className="space-y-2.5 text-xs text-white">
              <div className="flex gap-2.5"><span className="text-[#DF1278] font-bold shrink-0">01</span><span>Get matched with Early Talent from across SAP's global offices and regions.</span></div>
              <div className="flex gap-2.5"><span className="text-[#DF1278] font-bold shrink-0">02</span><span>Have a coffee chat, confirm you met, and earn passport stamps for every connection.</span></div>
              <div className="flex gap-2.5"><span className="text-[#DF1278] font-bold shrink-0">03</span><span>Collect stamps from different regions and offices to unlock milestone badges.</span></div>
            </div>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {SIGNUP_STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{
                    backgroundColor: i <= step ? "#002060" : "#D1EFFF",
                    color: i <= step ? "#fff" : "#7C8896",
                  }}>
                  {i < step ? <Check size={12} /> : i + 1}
                </div>
                <span className="text-xs font-medium" style={{ color: i <= step ? "#002060" : "#7C8896" }}>{s}</span>
              </div>
              {i < SIGNUP_STEPS.length - 1 && (
                <div className="w-8 h-px" style={{ backgroundColor: i < step ? "#002060" : "#CFE6FA" }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step 0 — Privacy & Consent (signup only) */}
        {step === 0 && !editMode && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 space-y-4" style={{ border: "1px solid #CFE6FA" }}>
              <h2 className="font-semibold text-[#002060]" style={{ fontFamily: "'Fraunces', serif" }}>
                Privacy &amp; Data Notice
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { emoji: "📋", title: "What we collect", body: "Name, role, office & interests — used only for matching." },
                  { emoji: "👥", title: "Who can see it", body: "Other participants see your name, role, office & badges. Stamps are private." },
                  { emoji: "🗓️", title: "How long we keep it", body: "For the duration of your participation. Delete anytime from your profile." },
                  { emoji: "⚖️", title: "Your rights", body: "Access, correct or delete your data at any time under GDPR." },
                ].map(({ emoji, title, body }) => (
                  <div key={title} className="rounded-xl p-3 space-y-1"
                    style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF" }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{emoji}</span>
                      <span className="text-xs font-semibold text-[#002060]">{title}</span>
                    </div>
                    <p className="text-xs text-[#445063] leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-3 pt-1">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={consent.dataProcessing}
                    onChange={e => setConsent(c => ({ ...c, dataProcessing: e.target.checked }))}
                    className="mt-0.5 shrink-0 accent-[#002060]" />
                  <span className="text-xs text-[#445063] leading-relaxed">
                    I have read the privacy notice and consent to SAP collecting and using my name, role, office, and interests for the Connections Passport matching program. My profile will be visible to other participants. <span className="text-[#DF1278] font-semibold">*</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Community Guidelines */}
            <div className="rounded-2xl bg-white p-6 space-y-4" style={{ border: "1px solid #CFE6FA" }}>
              <h2 className="font-semibold text-[#002060]" style={{ fontFamily: "'Fraunces', serif" }}>
                Community Guidelines
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { emoji: "🤝", rule: "Be respectful", detail: "Professional, inclusive behaviour only." },
                  { emoji: "📅", rule: "Show up", detail: "Schedule your chat within the 7-day window." },
                  { emoji: "✅", rule: "Be honest", detail: "Only confirm a chat once it's actually happened." },
                  { emoji: "🚩", rule: "Report issues", detail: "Report misuse or inappropriate behaviour directly to the SAP Next Gen E2E team." },
                ].map(({ emoji, rule, detail }) => (
                  <div key={rule} className="rounded-xl p-3 space-y-1"
                    style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF" }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{emoji}</span>
                      <span className="text-xs font-semibold text-[#002060]">{rule}</span>
                    </div>
                    <p className="text-xs text-[#445063] leading-relaxed">{detail}</p>
                    {rule === "Report issues" && (
                      <button onClick={() => setShowReportModal(true)}
                        className="text-xs font-medium mt-1"
                        style={{ color: "#1B90FF" }}>
                        Contact SAP Next Gen E2E team →
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-3 pt-1">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={consent.guidelines}
                    onChange={e => setConsent(c => ({ ...c, guidelines: e.target.checked }))}
                    className="mt-0.5 shrink-0 accent-[#002060]" />
                  <span className="text-xs text-[#445063] leading-relaxed">
                    I agree to follow the Community Guidelines. <span className="text-[#DF1278] font-semibold">*</span>
                  </span>
                </label>
              </div>
            </div>
            <button onClick={() => setStep(1)} disabled={!consentValid}
              className="w-full rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#002060", color: "#fff" }}>
              I agree — continue <ArrowRight size={15} />
            </button>

            {/* Report issues modal */}
            {showReportModal && (
              <div style={{
                position: "fixed", inset: 0, zIndex: 300,
                backgroundColor: "rgba(0,32,96,0.6)", backdropFilter: "blur(4px)",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
              }}>
                <div className="rounded-2xl bg-white w-full max-w-md p-6 space-y-4"
                  style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-[#002060]" style={{ fontFamily: "'Fraunces', serif" }}>
                      Report an Issue
                    </h3>
                    <button onClick={() => { setShowReportModal(false); setReportCopied(false); }}
                      style={{ color: "#7C8896" }}><X size={16} /></button>
                  </div>
                  <p className="text-xs text-[#445063]">
                    Copy the template below, then open a <span className="font-semibold text-[#002060]">new email in Outlook</span>, paste it in, fill in the details, and send it to <span className="font-semibold text-[#002060]">SAPnextgen@sap.com</span>.
                  </p>
                  <ol className="space-y-1">
                    {["Click \"Copy to clipboard\" below.", "Open Outlook, create a new email, and paste the template into the body.", "Fill in the details where indicated.", "Send to SAPnextgen@sap.com."].map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-[#445063]">
                        <span className="font-bold shrink-0" style={{ color: "#DF1278" }}>{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="rounded-xl p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap overflow-y-auto"
                    style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF", color: "#002060", maxHeight: 220 }}>
{`To: SAPnextgen@sap.com
Subject: Connections Passport — Report an Issue

Hi SAP Next Gen E2E Team,

I would like to report the following issue with the Connections Passport program:

[Please describe the issue here]

Thank you.`}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`To: SAPnextgen@sap.com\nSubject: Connections Passport — Report an Issue\n\nHi SAP Next Gen E2E Team,\n\nI would like to report the following issue with the Connections Passport program:\n\n[Please describe the issue here]\n\nThank you.`)
                        .then(() => { setReportCopied(true); setTimeout(() => setReportCopied(false), 3000); })
                        .catch(() => {});
                    }}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                    style={{ backgroundColor: reportCopied ? "#EAF5FF" : "#002060", color: reportCopied ? "#1B90FF" : "#fff" }}>
                    {reportCopied ? <><Check size={14} /> Copied!</> : <>📋 Copy to clipboard</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 1 — Profile */}
        {step === 1 && (
          <div className="space-y-4">
          <div className="rounded-2xl bg-white p-6 space-y-5" style={{ border: "1px solid #CFE6FA" }}>
            <h2 className="font-semibold text-[#002060]" style={{ fontFamily: "'Fraunces', serif" }}>
              Tell us about yourself
            </h2>

            <div>
              <label className="text-xs font-semibold text-[#002060] block mb-1">Full name</label>
              {/* [SSO-INTEGRATION-POINT] Name is pre-filled and locked when provided by SSO */}
              <input value={form.name} onChange={e => !ssoUser && update("name", e.target.value)}
                placeholder="e.g. Jordan Lee"
                readOnly={!!ssoUser}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                style={{ borderColor: "#CFE6FA", backgroundColor: ssoUser ? "#F5FAFF" : "#fff", cursor: ssoUser ? "default" : "text" }} />
              {ssoUser && (
                <p className="text-[11px] text-[#7C8896] mt-1">
                  ✓ Pre-filled from your SAP profile via SSO
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-[#002060] block mb-1">Role / Program</label>
              <select value={form.role} onChange={e => update("role", e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{ borderColor: "#CFE6FA" }}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#002060] block mb-1">SAP Office</label>
              <select value={form.office} onChange={e => update("office", e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{ borderColor: "#CFE6FA" }}>
                {OFFICES.map(o => <option key={o.office}>{o.office}</option>)}
              </select>
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#7C8896]">
                <span>{COUNTRY_EMOJI[form.country] || "🌐"}</span>
                <span>{form.country}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: REGION_COLOR[form.region]?.bg, color: REGION_COLOR[form.region]?.text }}>
                  {form.region}
                </span>
                <span>{getTimezone(form.office, form.country)}</span>
              </div>
            </div>

            <button onClick={() => setStep(2)} disabled={!step1Valid}
              className="w-full rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#002060", color: "#fff" }}>
              Continue <ArrowRight size={15} />
            </button>
          </div>

          {/* Account settings — edit mode only */}
          {editMode && onPause && onDelete && (
            <div className="rounded-2xl bg-white p-6 space-y-4" style={{ border: "1px solid #CFE6FA" }}>
              <h3 className="font-semibold text-[#002060] text-sm" style={{ fontFamily: "'Fraunces', serif" }}>
                Account Settings
              </h3>

              {/* Pause matching */}
              <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: "#EAF5FF" }}>
                <div>
                  <div className="text-sm font-medium text-[#002060]">Pause matching</div>
                  <div className="text-xs text-[#7C8896] mt-0.5">
                    {isPaused ? "You're paused — you won't appear in new matches." : "Temporarily stop appearing in new matches. Your existing matches stay active."}
                  </div>
                </div>
                <button onClick={onPause}
                  className="rounded-full px-4 py-2 text-xs font-semibold transition-colors shrink-0 ml-4"
                  style={{
                    backgroundColor: isPaused ? "#EAF5FF" : "#002060",
                    color: isPaused ? "#002060" : "#fff",
                    border: isPaused ? "1px solid #CFE6FA" : "none",
                  }}>
                  {isPaused ? "Resume matching" : "Pause matching"}
                </button>
              </div>

              {/* Delete account */}
              <div>
                <div className="text-sm font-medium text-[#002060]">Delete my account</div>
                <div className="text-xs text-[#7C8896] mt-0.5 mb-3">
                  Permanently removes your profile and match history. Stamps you've already awarded to others will remain as a record of genuine connections. This action cannot be undone.
                </div>
                <button onClick={() => setShowDeleteModal(true)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold"
                  style={{ backgroundColor: "#FFF0F5", color: "#DF1278", border: "1px solid #FFB3D1" }}>
                  Request account deletion
                </button>
              </div>
            </div>
          )}

          {/* Delete confirmation modal */}
          {showDeleteModal && (
            <div style={{
              position: "fixed", inset: 0, zIndex: 300,
              backgroundColor: "rgba(0,32,96,0.6)", backdropFilter: "blur(4px)",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
            }}>
              <div className="rounded-2xl bg-white w-full max-w-md p-6 space-y-4"
                style={{ border: "1px solid #FFB3D1", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "#FFF0F5" }}>
                    <X size={18} color="#DF1278" />
                  </div>
                  <h3 className="font-semibold text-[#002060]" style={{ fontFamily: "'Fraunces', serif" }}>
                    Delete your account?
                  </h3>
                </div>

                <div className="rounded-xl p-4 space-y-2 text-xs text-[#445063] leading-relaxed"
                  style={{ backgroundColor: "#FFF8F9", border: "1px solid #FFE0EB" }}>
                  <p><span className="font-semibold text-[#DF1278]">What gets deleted:</span> Your profile, interests, match history, stamps, and badges.</p>
                  <p><span className="font-semibold text-[#002060]">What stays:</span> Stamps you awarded to others remain — they represent real conversations that took place. Your name will show as "SAP Next Gen Member" in their history.</p>
                  <p><span className="font-semibold text-[#002060]">GDPR right to erasure:</span> Under Article 17 of the GDPR, you have the right to request deletion of your personal data. This action will be processed immediately in this prototype. In production, a 30-day deletion window applies.</p>
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setShowDeleteModal(false)}
                    className="flex-1 rounded-xl py-2.5 text-sm font-semibold border"
                    style={{ borderColor: "#CFE6FA", color: "#002060", backgroundColor: "#fff" }}>
                    Cancel
                  </button>
                  <button onClick={() => { setShowDeleteModal(false); onDelete(); }}
                    className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
                    style={{ backgroundColor: "#DF1278", color: "#fff" }}>
                    Yes, delete my account
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Step 2 — Interests */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-white p-6" style={{ border: "1px solid #CFE6FA" }}>
              <h2 className="font-semibold text-[#002060] mb-1" style={{ fontFamily: "'Fraunces', serif" }}>
                {editMode ? "Update your interests" : "Pick your interests"}
              </h2>
              <p className="text-xs text-[#7C8896] mb-5">
                Choose 2–10 topics — we use these to find you more relevant matches and conversation starters.
                <span className="ml-2 font-medium" style={{ color: form.interests.length >= 2 ? "#1B90FF" : "#7C8896" }}>
                  {form.interests.length}/10 selected
                </span>
              </p>

              <div className="space-y-5">
                {INTEREST_CATEGORIES.map(cat => (
                  <div key={cat.label}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-base">{cat.emoji}</span>
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#7C8896]"
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        {cat.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {cat.items.map(item => {
                        const selected = form.interests.includes(item);
                        const maxed = !selected && form.interests.length >= 10;
                        return (
                          <button key={item} onClick={() => toggleInterest(item)} disabled={maxed}
                            className="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: selected ? "#002060" : "#EAF5FF",
                              color: selected ? "#fff" : maxed ? "#B0C4D8" : "#002060",
                              border: `1.5px solid ${selected ? "#002060" : "#D1EFFF"}`,
                              transform: selected ? "scale(1.04)" : "scale(1)",
                            }}>
                            {selected && <span className="mr-1">✓</span>}{item}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Other — free text */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-base">✏️</span>
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#7C8896]"
                      style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      Other
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={otherInterest}
                      onChange={e => setOtherInterest(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && otherInterest.trim() && form.interests.length < 10) {
                          toggleInterest(otherInterest.trim());
                          setOtherInterest("");
                        }
                      }}
                      placeholder="Type your own and press Enter…"
                      className="flex-1 rounded-full border px-3.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                      style={{ borderColor: "#D1EFFF" }}
                    />
                    <button
                      onClick={() => {
                        if (otherInterest.trim() && form.interests.length < 10) {
                          toggleInterest(otherInterest.trim());
                          setOtherInterest("");
                        }
                      }}
                      disabled={!otherInterest.trim() || form.interests.length >= 10}
                      className="rounded-full px-3.5 py-1.5 text-xs font-medium disabled:opacity-40"
                      style={{ backgroundColor: "#002060", color: "#fff" }}>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(editMode ? 1 : 1)}
                className="flex-1 rounded-xl py-3 font-semibold text-sm border"
                style={{ borderColor: "#CFE6FA", color: "#002060", backgroundColor: "#fff" }}>
                Back
              </button>
              <button onClick={() => setStep(3)} disabled={!step2Valid}
                className="flex-1 rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#002060", color: "#fff" }}>
                Continue <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6" style={{ border: "1px solid #CFE6FA" }}>
              <h2 className="font-semibold text-[#002060] mb-4" style={{ fontFamily: "'Fraunces', serif" }}>
                {editMode ? "Review your changes" : "Review your profile"}
              </h2>

              <div className="flex items-center gap-4 mb-5 pb-5 border-b" style={{ borderColor: "#EAF5FF" }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold shrink-0"
                  style={{ backgroundColor: "#D1EFFF", color: "#002060" }}>
                  {form.name.split(" ").map(p => p[0]).slice(0,2).join("")}
                </div>
                <div>
                  <div className="font-semibold text-[#002060]" style={{ fontFamily: "'Fraunces', serif" }}>
                    {form.name}
                  </div>
                  <div className="text-sm text-[#445063]">{form.role}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[#7C8896]">
                    <span>{COUNTRY_EMOJI[form.country] || "🌐"}</span>
                    <span>{form.office}, {form.country}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: REGION_COLOR[form.region]?.bg, color: REGION_COLOR[form.region]?.text }}>
                      {form.region}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#002060] mb-2">
                  Your interests ({form.interests.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.interests.map(i => (
                    <span key={i} className="rounded-full px-3 py-1 text-xs font-medium"
                      style={{ backgroundColor: "#EAF5FF", color: "#002060", border: "1px solid #D1EFFF" }}>
                      {i}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(2)}
                className="flex-1 rounded-xl py-3 font-semibold text-sm border"
                style={{ borderColor: "#CFE6FA", color: "#002060", backgroundColor: "#fff" }}>
                Back
              </button>
              <button onClick={() => onComplete(form)}
                className="flex-1 rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2"
                style={{ backgroundColor: "#DF1278", color: "#fff", boxShadow: "0 4px 14px rgba(223,18,120,0.35)" }}>
                {editMode ? <><Check size={15} /> Save changes</> : <><Coffee size={15} /> Join now</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------- Landing Page ---------------------- */

function LandingPage({ onJoin, ssoUser }) {
  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#EAF5FF" }}>
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-12">

        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-2"
            style={{ backgroundColor: "#002060" }}>
            <Coffee size={30} color="#DF1278" />
          </div>
          <h1 className="text-4xl font-semibold text-[#002060]"
            style={{ fontFamily: "'Fraunces', serif", lineHeight: 1.15 }}>
            Meet your next colleague.<br />Anywhere in the world.
          </h1>
          <p className="text-base text-[#445063] max-w-xl mx-auto leading-relaxed">
            Connections Passport matches SAP Next Gen talent across global offices for 30-minute coffee chats. Collect stamps, earn badges, and build a network that spans the globe.
          </p>
          {/* [SSO-INTEGRATION-POINT] Replace onClick with BTP XSUAA redirect when deployed */}
          {ssoUser ? (
            <div className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium mt-2"
              style={{ backgroundColor: "#EAF5FF", color: "#002060", border: "1px solid #CFE6FA" }}>
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Signed in as {ssoUser.name} · <button onClick={onJoin} className="font-semibold" style={{ color: "#DF1278" }}>Apply now →</button>
            </div>
          ) : (
            <button onClick={onJoin}
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 font-semibold text-sm mt-2"
              style={{ backgroundColor: "#DF1278", color: "#fff", boxShadow: "0 4px 18px rgba(223,18,120,0.35)" }}>
              <LogIn size={16} /> Sign in with SAP
            </button>
          )}
        </div>

        {/* What's in it for me */}
        <div>
          <div className="text-center mb-6">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#7C8896]"
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              How it works
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { emoji: "🎰", step: "01", title: "Get matched", body: "Spin the matcher to find someone new. Every match is a different office or region." },
              { emoji: "☕", step: "02", title: "Have a chat", body: "Schedule a 30-min coffee chat. An AI icebreaker helps you kick things off." },
              { emoji: "🎖️", step: "03", title: "Earn stamps", body: "Both confirm the chat happened and earn a passport stamp. Collect them all." },
            ].map(({ emoji, step, title, body }) => (
              <div key={step} className="rounded-2xl p-5 text-center space-y-2"
                style={{ backgroundColor: "#fff", border: "1px solid #CFE6FA" }}>
                <div className="text-3xl">{emoji}</div>
                <div className="text-xs font-bold" style={{ color: "#DF1278", fontFamily: "'IBM Plex Mono', monospace" }}>{step}</div>
                <div className="font-semibold text-sm text-[#002060]">{title}</div>
                <p className="text-xs text-[#445063] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Passport stamps preview */}
        <div>
          <h2 className="text-xl font-semibold text-[#002060] text-center mb-4"
            style={{ fontFamily: "'Fraunces', serif" }}>
            Collect passport stamps
          </h2>
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, #001642 0%, #002060 60%, #0A3D8F 100%)", boxShadow: "0 8px 32px rgba(0,32,96,0.2)" }}>
            <div className="px-6 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="text-[10px] tracking-[0.2em] uppercase font-medium mb-1"
                style={{ color: "#89D1FF", fontFamily: "'IBM Plex Mono', monospace" }}>
                SAP Next Gen · Digital Passport
              </div>
              <div className="text-lg font-semibold text-white" style={{ fontFamily: "'Fraunces', serif" }}>Your Name Here</div>
              <div className="text-xs text-white opacity-60">iXp Intern · Berlin</div>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Region stamps */}
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-3"
                  style={{ color: "rgba(137,209,255,0.6)", fontFamily: "'IBM Plex Mono', monospace" }}>Regions</div>
                <div className="flex flex-wrap gap-3">
                  {[
                    { label: "EMEA", bg: "#1B90FF", text: "#fff", count: 3 },
                    { label: "APAC", bg: "#89D1FF", text: "#002060", count: 2 },
                    { label: "NA",   bg: "#DF1278", text: "#fff", count: 1 },
                  ].map(r => (
                    <div key={r.label} className="flex flex-col items-center justify-between rounded-xl p-3 gap-2"
                      style={{ backgroundColor: r.bg, minWidth: 80, minHeight: 90,
                        transform: `rotate(${r.label === "EMEA" ? -2 : r.label === "APAC" ? 1 : -3}deg)`,
                        border: "2px double rgba(255,255,255,0.3)", boxShadow: "0 2px 8px rgba(0,32,96,0.25)" }}>
                      <Globe2 size={22} color={r.text} opacity={0.8} />
                      <div className="text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wide"
                          style={{ color: r.text, fontFamily: "'IBM Plex Mono', monospace" }}>{r.label}</div>
                        <div className="text-[9px] opacity-70" style={{ color: r.text }}>{r.count} chat{r.count > 1 ? "s" : ""}</div>
                      </div>
                    </div>
                  ))}
                  {/* Ghost stamp */}
                  <div className="flex flex-col items-center justify-center rounded-xl p-3 gap-2"
                    style={{ minWidth: 80, minHeight: 90, border: "2px dashed rgba(255,255,255,0.15)", opacity: 0.35 }}>
                    <Globe2 size={22} color="#89D1FF" />
                    <div className="text-[10px] uppercase tracking-wide text-center"
                      style={{ color: "#89D1FF", fontFamily: "'IBM Plex Mono', monospace" }}>MEE</div>
                  </div>
                </div>
              </div>
              {/* Office stamps */}
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-3"
                  style={{ color: "rgba(137,209,255,0.6)", fontFamily: "'IBM Plex Mono', monospace" }}>Offices</div>
                <div className="flex flex-wrap gap-3">
                  {[
                    { label: "Walldorf",       country: "Germany",        count: 2 },
                    { label: "Singapore",       country: "Singapore",      count: 1 },
                    { label: "Palo Alto",       country: "United States",  count: 1 },
                    { label: "Newtown Square",  country: "United States",  count: 1 },
                    { label: "Tokyo",           country: "Japan",          count: 1 },
                    { label: "Dublin",          country: "Ireland",        count: 1 },
                    { label: "Sydney",          country: "Australia",      count: 2 },
                    { label: "São Paulo",       country: "Brazil",         count: 1 },
                    { label: "Dubai",           country: "UAE",            count: 1 },
                    { label: "London",          country: "United Kingdom", count: 1 },
                    { label: "Bangalore",       country: "India",          count: 1 },
                    { label: "Vancouver",       country: "Canada",         count: 1 },
                  ].map((o, i) => (
                    <div key={o.label} className="flex flex-col items-center justify-between rounded-xl p-3 gap-2"
                      style={{ backgroundColor: "#002060", minWidth: 80, minHeight: 90,
                        transform: `rotate(${[-2, 1, 3, -1, 2, -3, 1, -2, 3, -1, 2, -3][i % 12]}deg)`,
                        border: "2px double rgba(255,255,255,0.15)", boxShadow: "0 2px 8px rgba(0,32,96,0.25)" }}>
                      <span style={{ fontSize: 26, lineHeight: 1 }}>{COUNTRY_EMOJI[o.country] || "🌐"}</span>
                      <div className="text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wide"
                          style={{ color: "#89D1FF", fontFamily: "'IBM Plex Mono', monospace" }}>{o.label}</div>
                        <div className="text-[9px] opacity-60" style={{ color: "#89D1FF" }}>{o.count} chat{o.count > 1 ? "s" : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Badges teaser */}
        <div>
          <h2 className="text-xl font-semibold text-[#002060] text-center mb-4"
            style={{ fontFamily: "'Fraunces', serif" }}>
            Earn milestone badges
          </h2>
          <div className="rounded-2xl p-6" style={{ backgroundColor: "#fff", border: "1px solid #CFE6FA" }}>
            <div className="flex justify-center flex-wrap gap-3">
              {[
                { icon: Coffee,    name: "First Connection" },
                { icon: Globe2,    name: "EMEA Explorer" },
                { icon: Globe2,    name: "Global Explorer" },
                { icon: Building2, name: "Office Hopper" },
                { icon: Award,     name: "Passport Pro" },
                { icon: Sparkles,  name: "Stamp Collector" },
              ].map(({ icon: Icon, name }) => (
                <div key={name} className="flex flex-col items-center gap-1.5 rounded-xl p-3 w-24"
                  style={{ backgroundColor: "#EAF5FF", border: "1px solid #D1EFFF" }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "#002060" }}>
                    <Icon size={16} color="#89D1FF" />
                  </div>
                  <span className="text-[10px] font-medium text-center text-[#002060] leading-tight">{name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center space-y-3 pb-4">
          <p className="text-sm text-[#445063]">Ready to start collecting stamps?</p>
          {/* [SSO-INTEGRATION-POINT] Replace onClick with BTP XSUAA redirect when deployed */}
          <button onClick={onJoin}
            className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 font-semibold text-sm"
            style={{ backgroundColor: "#002060", color: "#fff", boxShadow: "0 4px 14px rgba(0,32,96,0.25)" }}>
            {ssoUser ? <><ArrowRight size={16} /> Apply now</> : <><LogIn size={16} /> Sign in with SAP</>}
          </button>
        </div>

      </div>
    </div>
  );
}



function AdminPanel({ users, matches }) {
  const optedIn = users.filter(u => u.optedIn).length;
  const completed = matches.filter(m => m.status === "completed").length;
  const active = matches.filter(m => m.status === "active").length;
  const pending = matches.filter(m => m.status === "pending_confirmation").length;
  const completion = matches.length ? Math.round(completed / matches.length * 100) : 0;
  const regionCoverage = new Set(users.flatMap(u => Object.keys(u.collectedRegions))).size;
  const officeCoverage = new Set(users.flatMap(u => Object.keys(u.collectedOffices))).size;

  function tally(field) {
    const c = {};
    users.forEach(u => Object.entries(u[field]).forEach(([k, v]) => c[k] = (c[k] || 0) + v));
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }

  const metrics = [
    ["Opt-ins", optedIn], ["Active matches", active], ["Completed chats", completed],
    ["Completion rate", `${completion}%`], ["Pending confirmation", pending],
    ["Region coverage", `${regionCoverage}/${REGIONS.length}`],
    ["Office coverage", `${officeCoverage}/${OFFICES.length}`],
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PanelHeader icon={LayoutDashboard}>Admin Dashboard</PanelHeader>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="grid grid-cols-4 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-xl p-3 border" style={{ backgroundColor: "#F5FAFF", borderColor: "#CFE6FA" }}>
              <div className="text-base font-semibold" style={{ fontFamily: "'Fraunces', serif", color: "#002060" }}>{value}</div>
              <div className="text-[10px] text-[#7C8896]">{label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { title: "Top regions", data: tally("collectedRegions") },
            { title: "Top offices", data: tally("collectedOffices") },
            { title: "Most badges", data: [...users].sort((a, b) => b.badges.length - a.badges.length).slice(0, 5).map(u => [u.name, u.badges.length]) },
          ].map(({ title, data }) => (
            <div key={title} className="rounded-xl border p-3" style={{ borderColor: "#CFE6FA" }}>
              <div className="text-xs font-semibold text-[#002060] mb-2">{title}</div>
              {data.map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs py-1 border-b last:border-0 text-[#445063]"
                  style={{ borderColor: "#EAF5FF" }}>
                  <span className="truncate">{k}</span>
                  <span className="font-mono text-[#7C8896] ml-2">{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#CFE6FA" }}>
          <div className="px-3 py-2 text-xs font-semibold text-[#002060] border-b" style={{ borderColor: "#CFE6FA", backgroundColor: "#EAF5FF" }}>
            Match history
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[#7C8896] border-b" style={{ borderColor: "#CFE6FA" }}>
                  <th className="px-3 py-2">Pair</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {matches.map(m => {
                  const a = users.find(u => u.id === m.userAId);
                  const b = users.find(u => u.id === m.userBId);
                  return (
                    <tr key={m.id} className="border-b last:border-0"
                      style={{ borderColor: "#EAF5FF", opacity: m.removed ? 0.55 : 1 }}>
                      <td className="px-3 py-2 text-[#002060]">{a?.name.split(" ")[0]} ↔ {b?.name.split(" ")[0]}</td>
                      <td className="px-3 py-2">
                        {m.removed
                          ? <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#7C8896" }}>
                              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: "#7C8896" }} />
                              Removed
                            </span>
                          : <StatusDot status={m.status} />}
                      </td>
                      <td className="px-3 py-2 text-[#7C8896] font-mono">{new Date(m.createdAt).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Root ---------------------- */

/* ---------------------- Stamp Sound ---------------------- */

function playStampSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Layer 1: low thud impact
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1); gain1.connect(ctx.destination);
    osc1.frequency.setValueAtTime(180, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.12);
    gain1.gain.setValueAtTime(0.9, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.25);
    // Layer 2: short snap crackle
    const bufSize = ctx.sampleRate * 0.05;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.4, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    src.connect(gain2); gain2.connect(ctx.destination);
    src.start(ctx.currentTime);
  } catch (e) { /* audio not supported, fail silently */ }
}

/* ---------------------- Incoming Match Modal ---------------------- */

function IncomingMatchModal({ match, matchedUser, onAcknowledge }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      backgroundColor: "rgba(0,32,96,0.6)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div className="rounded-3xl overflow-hidden w-full max-w-sm"
        style={{
          background: "linear-gradient(160deg, #001642, #002060 60%, #0A3D8F)",
          border: "1px solid rgba(27,144,255,0.3)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}>
        {/* Header glow strip */}
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #DF1278, #1B90FF, #89D1FF)" }} />

        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: "#DF1278" }}>
              <Coffee size={14} color="#fff" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest text-white"
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              New Connection Request
            </span>
          </div>

          <div className="flex items-center gap-4 mb-5">
            <Avatar name={matchedUser.name} email={matchedUser.email} size={56} />
            <div>
              <div className="font-semibold text-white text-base"
                style={{ fontFamily: "'Fraunces', serif" }}>
                {matchedUser.name}
              </div>
              <div className="text-sm text-white">{matchedUser.role}</div>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-white opacity-70">
                <span>{COUNTRY_EMOJI[matchedUser.country] || "🌐"}</span>
                <span>{matchedUser.office}, {matchedUser.country}</span>
                <span className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                  style={{ backgroundColor: REGION_COLOR[matchedUser.region]?.bg, color: REGION_COLOR[matchedUser.region]?.text }}>
                  {matchedUser.region}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl px-4 py-3 mb-5 text-xs text-white leading-relaxed"
            style={{ backgroundColor: "rgba(27,144,255,0.1)", border: "1px solid rgba(27,144,255,0.2)" }}>
            <span className="font-semibold text-white">{matchedUser.name}</span> wants to connect with you for a coffee chat.
            Schedule a time that works for both of you, then confirm once you've met — you'll each earn a passport stamp!
          </div>

          <div className="flex gap-3">
            <button onClick={onAcknowledge}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm"
              style={{ backgroundColor: "#1B90FF", color: "#fff", boxShadow: "0 4px 14px rgba(27,144,255,0.4)" }}>
              <Check size={15} /> Accept &amp; Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Stamp Celebration ---------------------- */

const CONFETTI_COLORS = ["#1B90FF","#89D1FF","#DF1278","#002060","#FFB3D1","#D1EFFF","#fff"];

function StampCelebration({ onDone }) {
  const pieces = React.useMemo(() => Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.8}s`,
    duration: `${1.4 + Math.random() * 1.2}s`,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: 6 + Math.floor(Math.random() * 8),
    shape: Math.random() > 0.5 ? "50%" : "2px",
  })), []);

  React.useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 200, overflow: "hidden" }}>
      {/* Confetti */}
      {pieces.map(p => (
        <div key={p.id} style={{
          position: "absolute",
          left: p.left, top: "-10px",
          width: p.size, height: p.size,
          borderRadius: p.shape,
          backgroundColor: p.color,
          animation: `confettiFall ${p.duration} ${p.delay} ease-in forwards`,
        }} />
      ))}

      {/* Stamp overlay */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
      }}>
        <div className="stamp-press stamp-fade flex flex-col items-center justify-center rounded-full"
          style={{
            width: 160, height: 160,
            border: "6px double #DF1278",
            backgroundColor: "rgba(223,18,120,0.08)",
            backdropFilter: "blur(2px)",
          }}>
          <Stamp size={36} color="#DF1278" />
          <div className="text-xs font-bold mt-2 tracking-widest uppercase"
            style={{ color: "#DF1278", fontFamily: "'IBM Plex Mono', monospace" }}>
            Stamped!
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Notification Banner ---------------------- */

function NotificationBanner({ notifications, onDismiss }) {
  if (notifications.length === 0) return null;
  const notif = notifications[0];
  return (
    <div className="notif-enter" style={{
      position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)",
      zIndex: 100, width: "100%", maxWidth: 480, padding: "0 16px",
    }}>
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl"
        style={{
          background: "linear-gradient(135deg, #002060, #0A3D8F)",
          border: "1px solid rgba(27,144,255,0.35)",
          boxShadow: "0 8px 32px rgba(0,32,96,0.35), 0 0 0 1px rgba(27,144,255,0.2)",
        }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: "#DF1278" }}>
          <Coffee size={16} color="#fff" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-white">{notif.title}</div>
          <div className="text-[11px] text-white opacity-80 mt-0.5 truncate">{notif.body}</div>
        </div>
        <button onClick={() => onDismiss(notif.id)}
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ color: "rgba(137,209,255,0.6)" }}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export default function CoffeePassportApp() {
  useFonts();

  // ── Demo seed state (read-only — never sent to backend) ─────────────────────
  const [demoState] = useState(() => {
    const u = seedUsers();
    const m = seedMatches(u);
    return { users: u, matches: m };
  });

  // ── Live backend state ───────────────────────────────────────────────────────
  const [liveUser, setLiveUser] = useState(null);      // real signed-in user (HANA)
  const [liveMatches, setLiveMatches] = useState([]);  // their matches (HANA)
  const [livePeers, setLivePeers] = useState([]);      // other opted-in real users (HANA)
  const [backendAvailable, setBackendAvailable] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState("landing");
  const [signedUpIds, setSignedUpIds] = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [celebrating, setCelebrating] = useState(false);
  const [ssoUser, setSsoUser] = useState(null);

  // ── Demo state (in-memory fallback, used when backend unavailable) ───────────
  const [demoUsers, setDemoUsers] = useState(demoState.users);
  const [demoMatches, setDemoMatches] = useState(demoState.matches);

  // ── Derived: which set of data to show ───────────────────────────────────────
  // When live: currentUser = liveUser; users/matches = live data + demo peers for matcher
  // When demo: currentUser = demoUsers[currentUserId]; users/matches = demo data
  const currentUser = backendAvailable
    ? liveUser
    : (demoUsers.find(u => u.id === currentUserId) || null);

  const hasSignedUp = backendAvailable
    ? liveUser !== null
    : signedUpIds.has(currentUserId);

  // All users visible to the matcher — live peers when backend is up, demo seed otherwise
  const matcherUsers = backendAvailable
    ? [liveUser, ...livePeers].filter(Boolean)
    : demoUsers;

  // Normalize live matches to include userAId/userBId aliases so UI components work unchanged
  const normalizedLiveMatches = useMemo(
    () => liveMatches.map(normalizeMatch),
    [liveMatches]
  );

  const activeMatches = backendAvailable ? normalizedLiveMatches : demoMatches;

  // ── SSO: fetch real user identity on mount ───────────────────────────────────
  // [SSO-INTEGRATION-POINT] On BTP the App Router injects the XSUAA JWT automatically.
  React.useEffect(() => {
    fetch("/user-api/currentUser", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.email) {
          const fullName = (data.firstname && data.lastname)
            ? `${data.firstname} ${data.lastname}`
            : (data.name || data.displayName || data.email || "");
          setSsoUser({
            name: fullName,
            email: data.email || "",
            country: data.country || "",
            office: data.companyLocation || "",
          });
        }
      })
      .catch(() => {}); // silently fail on localhost
  }, []);

  // ── Backend: load user state once SSO email is known ────────────────────────
  // [BACKEND-INTEGRATION-POINT] Calls CAP /api/PassportService/getMyState()
  React.useEffect(() => {
    if (!ssoUser?.email) return;
    API.getMyState()
      .then(state => {
        if (!state) return; // backend not reachable — stay in demo mode
        setBackendAvailable(true);
        if (state.user) {
          const u = normalizeUser(state.user);
          setLiveUser(u);
          setCurrentUserId(u.email);
          setSignedUpIds(prev => new Set([...prev, u.email]));
        }
        setLiveMatches(state.matches || []);
        setLivePeers((state.peers || []).map(normalizeUser));
      })
      .catch(() => setBackendAvailable(false));
  }, [ssoUser?.email]);

  // ── SSO login handler ────────────────────────────────────────────────────────
  function handleSSOLogin() {
    if (ssoUser) { setView("signup"); return; }
    // Localhost dev fallback
    setSsoUser({ name: "Demo User", email: "demo@sap.com", country: "", office: "" });
    setView("signup");
  }

  // ── Incoming match detection ─────────────────────────────────────────────────
  const incomingMatch = useMemo(() => {
    if (!currentUser) return null;
    return activeMatches.find(m => m.userBId === currentUser.id && m.acknowledgedByB === false);
  }, [activeMatches, currentUser?.id]);

  const incomingMatchUser = incomingMatch
    ? matcherUsers.find(u => u.id === incomingMatch.userAId)
    : null;

  // ── Notifications ────────────────────────────────────────────────────────────
  function pushNotif(title, body) {
    const id = Date.now();
    setNotifications(n => [...n, { id, title, body }]);
    setTimeout(() => setNotifications(n => n.filter(x => x.id !== id)), 5000);
  }
  function dismissNotif(id) { setNotifications(n => n.filter(x => x.id !== id)); }

  // ── Rate limits (derived from current user state) ────────────────────────────
  const reshufflesLeft = useMemo(() => {
    if (!currentUser) return MAX_RESHUFFLES_PER_DAY;
    if (currentUser.lastReshuffleDate !== todayStr()) return MAX_RESHUFFLES_PER_DAY;
    return Math.max(0, MAX_RESHUFFLES_PER_DAY - (currentUser.reshufflesUsedToday || 0));
  }, [currentUser]);

  const matchesLeft = useMemo(() => {
    if (!currentUser) return MAX_MATCHES_PER_DAY;
    if (currentUser.lastMatchAcceptDate !== todayStr()) return MAX_MATCHES_PER_DAY;
    return Math.max(0, MAX_MATCHES_PER_DAY - (currentUser.matchesAcceptedToday || 0));
  }, [currentUser]);

  // ── Action handlers — API when backend available, in-memory otherwise ─────────

  async function handleReshuffle() {
    if (backendAvailable) {
      await API.recordReshuffle().catch(() => {});
      setLiveUser(u => u ? {
        ...u,
        lastReshuffleDate: todayStr(),
        reshufflesUsedToday: u.lastReshuffleDate === todayStr()
          ? (u.reshufflesUsedToday || 0) + 1 : 1,
      } : u);
    } else {
      setDemoUsers(users => users.map(u => {
        if (u.id !== currentUser.id) return u;
        const isToday = u.lastReshuffleDate === todayStr();
        return { ...u, lastReshuffleDate: todayStr(), reshufflesUsedToday: isToday ? u.reshufflesUsedToday + 1 : 1 };
      }));
    }
  }

  async function handleAccept(otherUser) {
    if (backendAvailable && liveUser) {
      try {
        const match = await API.acceptMatch(otherUser.email || otherUser.id);
        setLiveMatches(m => [...m, match]);
        setLiveUser(u => u ? {
          ...u,
          lastMatchAcceptDate: todayStr(),
          matchesAcceptedToday: u.lastMatchAcceptDate === todayStr()
            ? (u.matchesAcceptedToday || 0) + 1 : 1,
        } : u);
        pushNotif("☕ New coffee match!", `You've been matched with ${otherUser.name} from ${otherUser.office}. Say hello!`);
      } catch (e) {
        pushNotif("Could not create match", e.message);
      }
    } else {
      setDemoUsers(users => {
        const me = users.find(u => u.id === currentUser.id);
        const isToday = me.lastMatchAcceptDate === todayStr();
        const acceptedToday = isToday ? me.matchesAcceptedToday : 0;
        if (acceptedToday >= MAX_MATCHES_PER_DAY) return users;
        const now = Date.now();
        const newMatch = {
          id: Math.max(0, ...demoMatches.map(m => m.id)) + 1,
          userAId: currentUser.id, userBId: otherUser.id,
          createdAt: now, expiresAt: now + 7 * 86400000,
          status: "active", confirmedA: false, confirmedB: false,
          acknowledgedByB: false,
        };
        setDemoMatches(m => [...m, newMatch]);
        pushNotif("☕ New coffee match!", `You've been matched with ${otherUser.name} from ${otherUser.office}. Say hello!`);
        return users.map(u => u.id === currentUser.id
          ? { ...u, lastMatchAcceptDate: todayStr(), matchesAcceptedToday: acceptedToday + 1 }
          : u);
      });
    }
  }

  async function handleConfirm(matchId) {
    if (backendAvailable) {
      try {
        const updated = await API.confirmMatch(matchId);
        setLiveMatches(m => m.map(x => x.id === matchId ? updated : x));
        if (updated.status === "completed") {
          // Reload user to get fresh stamps/badges from HANA
          API.getMyState().then(state => {
            if (state?.user) setLiveUser(normalizeUser(state.user));
          }).catch(() => {});
          setTimeout(() => { setCelebrating(true); playStampSound(); }, 100);
        }
      } catch (e) {
        pushNotif("Error", e.message);
      }
    } else {
      setDemoMatches(matches => {
        let completedPair = null;
        const updated = matches.map(m => {
          if (m.id !== matchId) return m;
          const isUserA = m.userAId === currentUser.id;
          const upd = { ...m, confirmedA: isUserA ? true : m.confirmedA, confirmedB: !isUserA ? true : m.confirmedB };
          const both = upd.confirmedA && upd.confirmedB;
          upd.status = both ? "completed" : "pending_confirmation";
          if (both) completedPair = [upd.userAId, upd.userBId];
          return upd;
        });
        if (completedPair) {
          const [aId, bId] = completedPair;
          setDemoUsers(users => users.map(u => {
            if (u.id !== aId && u.id !== bId) return u;
            const other = users.find(x => x.id === (u.id === aId ? bId : aId));
            const clone = { ...u, collectedRegions: { ...u.collectedRegions }, collectedOffices: { ...u.collectedOffices } };
            awardStamps(clone, other);
            recalcBadges(clone);
            return clone;
          }));
          setTimeout(() => { setCelebrating(true); playStampSound(); }, 100);
        }
        return updated;
      });
    }
  }

  async function handleAcknowledge(matchId) {
    if (backendAvailable) {
      await API.acknowledgeMatch(matchId).catch(() => {});
      setLiveMatches(m => m.map(x => x.id === matchId ? { ...x, acknowledgedByB: true } : x));
    } else {
      setDemoMatches(m => m.map(x => x.id === matchId ? { ...x, acknowledgedByB: true } : x));
    }
  }

  async function handleRemove(matchId) {
    if (backendAvailable) {
      await API.removeMatch(matchId).catch(() => {});
      setLiveMatches(m => m.map(x => x.id === matchId ? { ...x, removed: true, status: "expired" } : x));
    } else {
      setDemoMatches(m => m.map(x => x.id === matchId ? { ...x, removed: true } : x));
    }
  }

  async function handlePause() {
    if (backendAvailable) {
      await API.pauseUser().catch(() => {});
      setLiveUser(u => u ? { ...u, paused: !u.paused } : u);
    } else {
      setDemoUsers(users => users.map(u => u.id === currentUserId ? { ...u, paused: !u.paused } : u));
    }
  }

  async function handleDelete() {
    if (backendAvailable) {
      await API.deleteUser().catch(() => {});
      setLiveUser(u => u ? { ...u, deleted: true, name: "SAP Next Gen Member", optedIn: false } : u);
      setLiveMatches(m => m.map(x =>
        ["active", "pending_confirmation"].includes(x.status) ? { ...x, status: "expired" } : x
      ));
    } else {
      setDemoUsers(users => users.map(u => u.id === currentUserId
        ? { ...u, deleted: true, name: "SAP Next Gen Member", optedIn: false } : u));
      setDemoMatches(matches => matches.map(m =>
        (m.userAId === currentUserId || m.userBId === currentUserId) &&
        ["active", "pending_confirmation"].includes(m.status)
          ? { ...m, status: "expired" } : m
      ));
    }
    setView("dashboard");
  }

  return (
    <div className="flex flex-col" style={{ height: "100vh", backgroundColor: "#EAF5FF", fontFamily: "'Inter', sans-serif" }}>
      <NotificationBanner notifications={notifications} onDismiss={dismissNotif} />
      {celebrating && <StampCelebration onDone={() => setCelebrating(false)} />}
      {incomingMatch && incomingMatchUser && (
        <IncomingMatchModal
          match={incomingMatch}
          matchedUser={incomingMatchUser}
          onAcknowledge={() => handleAcknowledge(incomingMatch.id)}
        />
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
        style={{ backgroundColor: "#002060", borderColor: "#001642" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: "#DF1278" }}>
            <Coffee size={14} color="#fff" />
          </div>
          <span className="text-white font-semibold text-sm tracking-tight"
            style={{ fontFamily: "'Fraunces', serif" }}>
            SAP Next Gen Connections Passport
          </span>
        </div>
        {/* Nav tabs */}
        <div className="hidden sm:flex items-center gap-1 rounded-full p-1"
          style={{ backgroundColor: "#001642" }}>
          {(hasSignedUp ? ["dashboard","passport","signup"] : ["landing","dashboard","passport","signup"]).map(v => (
            <button key={v} onClick={() => { setView(v); setIsAdmin(false); }}
              className="px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors"
              style={{
                backgroundColor: view === v && !isAdmin ? "#1B90FF" : "transparent",
                color: view === v && !isAdmin ? "#fff" : "#89D1FF",
              }}>
              {v === "passport" ? "My Passport" : v === "signup" ? (hasSignedUp ? "Profile" : "Sign Up") : v === "landing" ? "Home" : "Dashboard"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Show signed-in user name when logged in */}
          {ssoUser && (
            <span className="text-xs rounded-full px-3 py-1.5"
              style={{ backgroundColor: "#0A3D8F", color: "#D1EFFF" }}>
              {ssoUser.name}
            </span>
          )}
          {/* Admin button — only visible to authorized admin email */}
          {ssoUser?.email === "j.partida@sap.com" && (
            <button onClick={() => setIsAdmin(a => !a)}
              className="flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 font-medium transition-colors"
              style={{ backgroundColor: isAdmin ? "#DF1278" : "#0A3D8F", color: "#fff" }}>
              <LayoutDashboard size={12} /> Admin
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col"
        style={{ display: "grid", gridTemplateRows: "1fr" }}>

        {/* Landing page */}
        {view === "landing" && !isAdmin && (
          <LandingPage onJoin={handleSSOLogin} ssoUser={ssoUser} />
        )}

        {/* Signup / Profile page */}
        {view === "signup" && !isAdmin && (
          <SignupPage
            users={matcherUsers}
            ssoUser={ssoUser}
            editMode={hasSignedUp}
            isPaused={currentUser?.paused}
            onPause={hasSignedUp ? handlePause : undefined}
            onDelete={hasSignedUp ? handleDelete : undefined}
            initialData={hasSignedUp && currentUser ? {
              name: currentUser.name, role: currentUser.role,
              office: currentUser.office, country: currentUser.country,
              region: currentUser.region, interests: currentUser.interests,
            } : null}
            onComplete={async form => {
              if (backendAvailable) {
                try {
                  const saved = await API.upsertUser({
                    name: form.name, role: form.role,
                    office: form.office, country: form.country,
                    region: form.region,
                    interests: Array.isArray(form.interests)
                      ? form.interests.join(",") : form.interests,
                    consentGiven: true,
                  });
                  const u = normalizeUser(saved);
                  setLiveUser(u);
                  setCurrentUserId(u.email);
                  setSignedUpIds(prev => new Set([...prev, u.email]));
                } catch (e) {
                  pushNotif("Error saving profile", e.message);
                  return;
                }
              } else {
                if (hasSignedUp) {
                  setDemoUsers(users => users.map(u => u.id === currentUser.id ? {
                    ...u, name: form.name, role: form.role,
                    region: form.region, country: form.country, office: form.office,
                    timezone: getTimezone(form.office, form.country), interests: form.interests,
                  } : u));
                } else {
                  const newId = Math.max(...demoUsers.map(u => u.id)) + 1;
                  const newUser = {
                    id: newId, name: form.name, role: form.role,
                    region: form.region, country: form.country, office: form.office,
                    timezone: getTimezone(form.office, form.country), interests: form.interests,
                    optedIn: true, paused: false, deleted: false, consentGiven: true,
                    collectedRegions: {}, collectedOffices: {},
                    chatsCompleted: 0, badges: [],
                    lastReshuffleDate: null, reshufflesUsedToday: 0,
                    lastMatchAcceptDate: null, matchesAcceptedToday: 0,
                  };
                  setCurrentUserId(newId);
                  setSignedUpIds(prev => new Set([...prev, newId]));
                  setDemoUsers(u => [...u, newUser]);
                }
              }
              setView("dashboard");
            }}
          />
        )}

        {view === "passport" && !isAdmin && (
          <PassportPage user={currentUser} />
        )}

        {/* Dashboard 3-panel grid */}
        {view === "dashboard" && !isAdmin && (
          <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: "280px 1fr 300px" }}>
            <div className="border-r overflow-hidden" style={{ borderColor: "#CFE6FA", backgroundColor: "#F5FAFF" }}>
              <PassportPanel user={currentUser} />
            </div>
            <div className="border-r overflow-hidden bg-white" style={{ borderColor: "#CFE6FA" }}>
              <MatchPanel
                users={matcherUsers} matches={activeMatches} currentUser={currentUser}
                onAccept={handleAccept} onReshuffle={handleReshuffle}
                reshufflesLeft={reshufflesLeft} matchesLeft={matchesLeft}
              />
            </div>
            <div className="overflow-hidden" style={{ backgroundColor: "#F5FAFF" }}>
              <MatchesPanel matches={activeMatches} users={matcherUsers} currentUser={currentUser} onConfirm={handleConfirm} onRemove={handleRemove} onAcknowledge={handleAcknowledge} />
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="flex-1 overflow-hidden bg-white">
            <AdminPanel users={matcherUsers} matches={activeMatches} />
          </div>
        )}
      </div>
    </div>
  );
}
