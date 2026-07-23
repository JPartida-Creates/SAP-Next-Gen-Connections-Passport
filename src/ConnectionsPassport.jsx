import React, { useState, useMemo, useCallback } from "react";
import {
  Coffee, MapPin, Globe2, Stamp, User, Users, Shuffle, Check, Clock,
  X, ShieldCheck, ArrowRight, ArrowLeft, Sparkles, Building2, Award,
  ChevronRight, LogIn, LayoutDashboard, BadgeCheck, Hourglass, Eye, EyeOff,
  Share2, HelpCircle
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
    const data = await res.json();
    // CAP wraps action return values in { value: ... }
    return data?.value ?? data;
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
  function asObj(val) {
    const parsed = parseJ(val, {});
    // Guard against Buffer-serialized objects, arrays, or other non-plain-objects
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    if ("type" in parsed && "data" in parsed) return {}; // Buffer remnant
    return parsed;
  }
  const collectedRegions = asObj(u.collectedRegions);
  const collectedOffices = asObj(u.collectedOffices);
  const partial = {
    ...u,
    id: u.email,
    collectedRegions,
    collectedOffices,
    chatsCompleted: u.chatsCompleted || 0,
    interests: typeof u.interests === "string"
      ? u.interests.split(",").map(s => s.trim()).filter(Boolean)
      : (u.interests || []),
    timezone: getTimezone(u.office, u.country),
  };
  // Always re-derive badges from live stats so stale HANA data never shows
  partial.badges = recalcBadges(partial);
  return partial;
}

/* Returns the name to display in the UI for a user.
   If the user set a preferred first name, that takes precedence everywhere. */
function displayName(user) {
  if (!user) return "";
  if (user.preferredName && user.preferredName.trim()) {
    const lastName = (user.name || "").trim().split(" ").slice(1).join(" ");
    return lastName ? `${user.preferredName.trim()} ${lastName}` : user.preferredName.trim();
  }
  return user.name || "";
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
   Type: display "'72Brand', sans-serif" (headings/names),
         body "'72Brand', sans-serif", utility "'72Brand', sans-serif"
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
  // Latin America
  { office: "Buenos Aires",        country: "Argentina",      region: "NA"   },
  { office: "Rio de Janeiro",      country: "Brazil",         region: "NA"   },
  { office: "Sao Paulo",           country: "Brazil",         region: "NA"   },
  { office: "Sao Leopoldo",        country: "Brazil",         region: "NA"   },
  { office: "Calgary",             country: "Canada",         region: "NA"   },
  { office: "Montreal",            country: "Canada",         region: "NA"   },
  { office: "Ottawa",              country: "Canada",         region: "NA"   },
  { office: "Toronto",             country: "Canada",         region: "NA"   },
  { office: "Vancouver",           country: "Canada",         region: "NA"   },
  { office: "Waterloo",            country: "Canada",         region: "NA"   },
  { office: "Santiago",            country: "Chile",          region: "NA"   },
  { office: "Bogota",              country: "Colombia",       region: "NA"   },
  { office: "Medellin",            country: "Colombia",       region: "NA"   },
  { office: "San Jose",            country: "Costa Rica",     region: "NA"   },
  { office: "Quito",               country: "Ecuador",        region: "NA"   },
  { office: "Mexico City",         country: "Mexico",         region: "NA"   },
  { office: "Monterrey",           country: "Mexico",         region: "NA"   },
  { office: "Panama City",         country: "Panama",         region: "NA"   },
  { office: "Lima",                country: "Peru",           region: "NA"   },
  { office: "San Juan",            country: "Puerto Rico",    region: "NA"   },
  // North America (US)
  { office: "Alpharetta",          country: "United States",  region: "NA"   },
  { office: "Atlanta",             country: "United States",  region: "NA"   },
  { office: "Austin",              country: "United States",  region: "NA"   },
  { office: "Bellevue",            country: "United States",  region: "NA"   },
  { office: "Birmingham",          country: "United States",  region: "NA"   },
  { office: "Boston",              country: "United States",  region: "NA"   },
  { office: "Chicago",             country: "United States",  region: "NA"   },
  { office: "Cincinnati",          country: "United States",  region: "NA"   },
  { office: "Colorado Springs",    country: "United States",  region: "NA"   },
  { office: "Houston",             country: "United States",  region: "NA"   },
  { office: "Reston",              country: "United States",  region: "NA"   },
  { office: "Indianapolis",        country: "United States",  region: "NA"   },
  { office: "La Crosse",           country: "United States",  region: "NA"   },
  { office: "Lake Mary",           country: "United States",  region: "NA"   },
  { office: "Miami",               country: "United States",  region: "NA"   },
  { office: "Minneapolis",         country: "United States",  region: "NA"   },
  { office: "Newport Beach",       country: "United States",  region: "NA"   },
  { office: "Newtown Square",      country: "United States",  region: "NA"   },
  { office: "New York",            country: "United States",  region: "NA"   },
  { office: "Palo Alto",           country: "United States",  region: "NA"   },
  { office: "Pittsburgh",          country: "United States",  region: "NA"   },
  { office: "Raleigh",             country: "United States",  region: "NA"   },
  { office: "San Diego",           country: "United States",  region: "NA"   },
  { office: "San Francisco",       country: "United States",  region: "NA"   },
  { office: "San Ramon",           country: "United States",  region: "NA"   },
  { office: "St Louis",            country: "United States",  region: "NA"   },
  { office: "Tempe",               country: "United States",  region: "NA"   },
  { office: "Washington D.C.",     country: "United States",  region: "NA"   },
  { office: "Caracas",             country: "Venezuela",      region: "NA"   },
  // Australia & New Zealand
  { office: "Adelaide",            country: "Australia",      region: "APAC" },
  { office: "Brisbane",            country: "Australia",      region: "APAC" },
  { office: "Canberra",            country: "Australia",      region: "APAC" },
  { office: "Melbourne",           country: "Australia",      region: "APAC" },
  { office: "Perth",               country: "Australia",      region: "APAC" },
  { office: "Sydney",              country: "Australia",      region: "APAC" },
  // China & Hong Kong
  { office: "Beijing",             country: "China",          region: "APAC" },
  { office: "Chengdu",             country: "China",          region: "APAC" },
  { office: "Dalian",              country: "China",          region: "APAC" },
  { office: "Guangzhou",           country: "China",          region: "APAC" },
  { office: "Hong Kong",           country: "Hong Kong",      region: "APAC" },
  { office: "Jinan",               country: "China",          region: "APAC" },
  { office: "Nanjing",             country: "China",          region: "APAC" },
  { office: "Shanghai",            country: "China",          region: "APAC" },
  { office: "Shenzhen",            country: "China",          region: "APAC" },
  { office: "Wuhan",               country: "China",          region: "APAC" },
  { office: "Xian",                country: "China",          region: "APAC" },
  // Southeast Asia & Pacific
  { office: "Jakarta",             country: "Indonesia",      region: "APAC" },
  { office: "Ahmedabad",           country: "India",          region: "APAC" },
  { office: "Bangalore",           country: "India",          region: "APAC" },
  { office: "Chennai",             country: "India",          region: "APAC" },
  { office: "Delhi",               country: "India",          region: "APAC" },
  { office: "Gurgaon",             country: "India",          region: "APAC" },
  { office: "Hyderabad",           country: "India",          region: "APAC" },
  { office: "Kolkata",             country: "India",          region: "APAC" },
  { office: "Mumbai",              country: "India",          region: "APAC" },
  { office: "Pune",                country: "India",          region: "APAC" },
  { office: "Nagoya",              country: "Japan",          region: "APAC" },
  { office: "Oita",                country: "Japan",          region: "APAC" },
  { office: "Osaka",               country: "Japan",          region: "APAC" },
  { office: "Tokyo",               country: "Japan",          region: "APAC" },
  { office: "Seoul",               country: "South Korea",    region: "APAC" },
  { office: "Kuala Lumpur",        country: "Malaysia",       region: "APAC" },
  { office: "Auckland",            country: "New Zealand",    region: "APAC" },
  { office: "Wellington",          country: "New Zealand",    region: "APAC" },
  { office: "Manila",              country: "Philippines",    region: "APAC" },
  { office: "Singapore",           country: "Singapore",      region: "APAC" },
  { office: "Bangkok",             country: "Thailand",       region: "APAC" },
  { office: "Taipei",              country: "Taiwan",         region: "APAC" },
  { office: "Hanoi",               country: "Vietnam",        region: "APAC" },
  { office: "Ho Chi Minh City",    country: "Vietnam",        region: "APAC" },
  // Germany
  { office: "Berlin",              country: "Germany",        region: "EMEA" },
  { office: "Bonn",                country: "Germany",        region: "EMEA" },
  { office: "Dresden",             country: "Germany",        region: "EMEA" },
  { office: "Duesseldorf",         country: "Germany",        region: "EMEA" },
  { office: "Frankfurt a.M.",      country: "Germany",        region: "EMEA" },
  { office: "Hamburg",             country: "Germany",        region: "EMEA" },
  { office: "Hannover",            country: "Germany",        region: "EMEA" },
  { office: "Heilbronn",           country: "Germany",        region: "EMEA" },
  { office: "Karlsruhe",           country: "Germany",        region: "EMEA" },
  { office: "Leipzig",             country: "Germany",        region: "EMEA" },
  { office: "Leverkusen",          country: "Germany",        region: "EMEA" },
  { office: "Markdorf",            country: "Germany",        region: "EMEA" },
  { office: "Mannheim",            country: "Germany",        region: "EMEA" },
  { office: "Munich",              country: "Germany",        region: "EMEA" },
  { office: "Potsdam",             country: "Germany",        region: "EMEA" },
  { office: "Rheda-Wiedenbrueck",  country: "Germany",        region: "EMEA" },
  { office: "St. Leon-Rot",        country: "Germany",        region: "EMEA" },
  { office: "St. Ingbert",         country: "Germany",        region: "EMEA" },
  { office: "Stuttgart",           country: "Germany",        region: "EMEA" },
  { office: "Walldorf",            country: "Germany",        region: "EMEA" },
  // MEE (Middle East & Africa)
  { office: "Abu Dhabi",           country: "UAE",            region: "MEE"  },
  { office: "Dubai",               country: "UAE",            region: "MEE"  },
  { office: "Luanda",              country: "Angola",         region: "MEE"  },
  { office: "Manama",              country: "Bahrain",        region: "MEE"  },
  { office: "Cairo",               country: "Egypt",          region: "MEE"  },
  { office: "Raanana",             country: "Israel",         region: "MEE"  },
  { office: "Tel Aviv",            country: "Israel",         region: "MEE"  },
  { office: "Baghdad",             country: "Iraq",           region: "MEE"  },
  { office: "Nairobi",             country: "Kenya",          region: "MEE"  },
  { office: "Kuwait City",         country: "Kuwait",         region: "MEE"  },
  { office: "Casablanca",          country: "Morocco",        region: "MEE"  },
  { office: "Lagos",               country: "Nigeria",        region: "MEE"  },
  { office: "Muscat",              country: "Oman",           region: "MEE"  },
  { office: "Islamabad",           country: "Pakistan",       region: "MEE"  },
  { office: "Karachi",             country: "Pakistan",       region: "MEE"  },
  { office: "Doha",                country: "Qatar",          region: "MEE"  },
  { office: "Al Khobar",           country: "Saudi Arabia",   region: "MEE"  },
  { office: "Jeddah",              country: "Saudi Arabia",   region: "MEE"  },
  { office: "Riyadh",              country: "Saudi Arabia",   region: "MEE"  },
  { office: "Cape Town",           country: "South Africa",   region: "MEE"  },
  { office: "Johannesburg",        country: "South Africa",   region: "MEE"  },
  // Rest of EMEA
  { office: "Vienna",              country: "Austria",        region: "EMEA" },
  { office: "Baku",                country: "Azerbaijan",     region: "EMEA" },
  { office: "Brussels",            country: "Belgium",        region: "EMEA" },
  { office: "Sofia",               country: "Bulgaria",       region: "EMEA" },
  { office: "Biel",                country: "Switzerland",    region: "EMEA" },
  { office: "Lausanne",            country: "Switzerland",    region: "EMEA" },
  { office: "Vevey",               country: "Switzerland",    region: "EMEA" },
  { office: "Zurich",              country: "Switzerland",    region: "EMEA" },
  { office: "Nicosia",             country: "Cyprus",         region: "EMEA" },
  { office: "Brno",                country: "Czech Republic", region: "EMEA" },
  { office: "Prague",              country: "Czech Republic", region: "EMEA" },
  { office: "Copenhagen",          country: "Denmark",        region: "EMEA" },
  { office: "Tallinn",             country: "Estonia",        region: "EMEA" },
  { office: "Barcelona",           country: "Spain",          region: "EMEA" },
  { office: "Madrid",              country: "Spain",          region: "EMEA" },
  { office: "Helsinki",            country: "Finland",        region: "EMEA" },
  { office: "Caen",                country: "France",         region: "EMEA" },
  { office: "Lyon",                country: "France",         region: "EMEA" },
  { office: "Mougins",             country: "France",         region: "EMEA" },
  { office: "Paris",               country: "France",         region: "EMEA" },
  { office: "Toulouse",            country: "France",         region: "EMEA" },
  { office: "Athens",              country: "Greece",         region: "EMEA" },
  { office: "Zagreb",              country: "Croatia",        region: "EMEA" },
  { office: "Budapest",            country: "Hungary",        region: "EMEA" },
  { office: "Dublin, IE",          country: "Ireland",        region: "EMEA" },
  { office: "Galway",              country: "Ireland",        region: "EMEA" },
  { office: "Genoa",               country: "Italy",          region: "EMEA" },
  { office: "Milan",               country: "Italy",          region: "EMEA" },
  { office: "Rome",                country: "Italy",          region: "EMEA" },
  { office: "Almaty",              country: "Kazakhstan",     region: "EMEA" },
  { office: "Astana",              country: "Kazakhstan",     region: "EMEA" },
  { office: "Vilnius",             country: "Lithuania",      region: "EMEA" },
  { office: "Luxembourg",          country: "Luxembourg",     region: "EMEA" },
  { office: "Riga",                country: "Latvia",         region: "EMEA" },
  { office: "Amsterdam",           country: "Netherlands",    region: "EMEA" },
  { office: "s-Hertogenbosch",     country: "Netherlands",    region: "EMEA" },
  { office: "Oslo",                country: "Norway",         region: "EMEA" },
  { office: "Krakow",              country: "Poland",         region: "EMEA" },
  { office: "Gliwice",             country: "Poland",         region: "EMEA" },
  { office: "Warsaw",              country: "Poland",         region: "EMEA" },
  { office: "Lisbon",              country: "Portugal",       region: "EMEA" },
  { office: "Bucharest",           country: "Romania",        region: "EMEA" },
  { office: "Cluj-Napoca",         country: "Romania",        region: "EMEA" },
  { office: "Timisoara",           country: "Romania",        region: "EMEA" },
  { office: "Belgrade",            country: "Serbia",         region: "EMEA" },
  { office: "Moscow",              country: "Russia",         region: "EMEA" },
  { office: "Gothenburg",          country: "Sweden",         region: "EMEA" },
  { office: "Malmoe",              country: "Sweden",         region: "EMEA" },
  { office: "Stockholm",           country: "Sweden",         region: "EMEA" },
  { office: "Ljubljana",           country: "Slovenia",       region: "EMEA" },
  { office: "Bratislava",          country: "Slovakia",       region: "EMEA" },
  { office: "Kosice",              country: "Slovakia",       region: "EMEA" },
  { office: "Ankara",              country: "Turkey",         region: "MEE"  },
  { office: "Istanbul",            country: "Turkey",         region: "MEE"  },
  { office: "Izmir",               country: "Turkey",         region: "MEE"  },
  { office: "Kyiv",                country: "Ukraine",        region: "EMEA" },
  { office: "Belfast",             country: "United Kingdom", region: "EMEA" },
  { office: "London",              country: "United Kingdom", region: "EMEA" },
  { office: "Manchester",          country: "United Kingdom", region: "EMEA" },
  { office: "Sittingbourne",       country: "United Kingdom", region: "EMEA" },
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
  "Peru": "PET (UTC-5)", "Ecuador": "ECT (UTC-5)", "Venezuela": "VET (UTC-4)",
  "Costa Rica": "CST (UTC-6)", "Panama": "EST (UTC-5)", "Puerto Rico": "AST (UTC-4)",
  "Hong Kong": "HKT (UTC+8)", "Taiwan": "CST (UTC+8)",
  "Angola": "WAT (UTC+1)", "Morocco": "WET (UTC+0)", "Pakistan": "PKT (UTC+5)",
  "Oman": "GST (UTC+4)", "Iraq": "AST (UTC+3)",
  "Azerbaijan": "AZT (UTC+4)", "Kazakhstan": "ALMT (UTC+6)",
  "Ukraine": "EET (UTC+2)", "Serbia": "CET (UTC+1)", "Croatia": "CET (UTC+1)",
  "Slovenia": "CET (UTC+1)", "Slovakia": "CET (UTC+1)", "Bulgaria": "EET (UTC+2)",
  "Cyprus": "EET (UTC+2)", "Estonia": "EET (UTC+2)", "Latvia": "EET (UTC+2)",
  "Lithuania": "EET (UTC+2)", "Luxembourg": "CET (UTC+1)",
  "Russia": "MSK (UTC+3)",
};

const OFFICE_TIMEZONES = {
  // Pacific (UTC-8)
  "Palo Alto":       "PST (UTC-8)", "San Francisco":  "PST (UTC-8)",
  "San Ramon":       "PST (UTC-8)", "San Diego":      "PST (UTC-8)",
  "Newport Beach":   "PST (UTC-8)", "Bellevue":       "PST (UTC-8)",
  "Vancouver":       "PST (UTC-8)",
  // Mountain (UTC-7)
  "Tempe":           "MST (UTC-7)", "Colorado Springs": "MST (UTC-7)",
  // Central (UTC-6)
  "Chicago":         "CST (UTC-6)", "Houston":        "CST (UTC-6)",
  "Austin":          "CST (UTC-6)", "St Louis":       "CST (UTC-6)",
  "Minneapolis":     "CST (UTC-6)", "La Crosse":      "CST (UTC-6)",
  "Monterrey":       "CST (UTC-6)", "Mexico City":    "CST (UTC-6)",
  // Eastern (UTC-5)
  "New York":        "EST (UTC-5)", "Boston":         "EST (UTC-5)",
  "Atlanta":         "EST (UTC-5)", "Alpharetta":     "EST (UTC-5)",
  "Washington D.C.": "EST (UTC-5)", "Newtown Square": "EST (UTC-5)",
  "Reston":          "EST (UTC-5)", "Pittsburgh":     "EST (UTC-5)",
  "Raleigh":         "EST (UTC-5)", "Cincinnati":     "EST (UTC-5)",
  "Indianapolis":    "EST (UTC-5)", "Birmingham":     "EST (UTC-5)",
  "Miami":           "EST (UTC-5)", "Lake Mary":      "EST (UTC-5)",
  "Toronto":         "EST (UTC-5)", "Montreal":       "EST (UTC-5)",
  "Ottawa":          "EST (UTC-5)",
  // Canada other
  "Calgary":         "MST (UTC-7)", "Waterloo":       "EST (UTC-5)",
  // Latin America
  "Ho Chi Minh City": "ICT (UTC+7)",
  "San Juan":        "AST (UTC-4)",
};

function getTimezone(office, country) {
  return OFFICE_TIMEZONES[office] || TIMEZONES[country] || "UTC+0";
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
  "STAR Student", "iXp Intern", "Academy Associate", "getX Early Talent", "Working Student", "Professional",
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
    // Exclude users from completed chats (both confirmed) AND active/pending matches.
    // Only truly expired/removed matches allow re-matching.
    if (m.status === "expired" || m.status === "removed") return;
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
  // Fonts are loaded via @font-face in index.css — no external link needed.
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
        style={{ color: "#5A6472", fontFamily: "'72Brand', sans-serif" }}>
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
          style={{ color: textColor, fontFamily: "'72Brand', sans-serif" }}>
          {label}
        </div>
        {sublabel && (
          <div className="text-[9px] opacity-70 mt-0.5" style={{ color: textColor }}>{sublabel}</div>
        )}
      </div>
      {count > 1 && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
          style={{ backgroundColor: "#DF1278", color: "#fff", fontFamily: "'72Brand', sans-serif" }}>
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
  const [showAllBadges, setShowAllBadges] = useState(false);
  function parseObj(val) {
    if (!val) return {};
    if (typeof val === "string") { try { return JSON.parse(val); } catch { return {}; } }
    if (typeof val === "object" && !Array.isArray(val)) return val;
    return {};
  }
  const collectedRegions = parseObj(user.collectedRegions);
  const collectedOffices = parseObj(user.collectedOffices);
  const regionEntries = Object.entries(collectedRegions).map(([k, v]) => [k, Number(v) || 0]);
  const officeEntries = Object.entries(collectedOffices).map(([k, v]) => [k, Number(v) || 0]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: "#F5FAFF" }}>
      <PanelHeader icon={Stamp}>My Passport</PanelHeader>

      {/* User card */}
      <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: "#CFE6FA" }}>
        <Avatar name={user.name} email={user.email} size={40} />
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
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
            <div className="text-base font-semibold" style={{ fontFamily: "'72Brand', sans-serif", color: "#002060" }}>{s.value}</div>
            <div className="text-[10px] text-[#7C8896]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Stamps — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#7C8896] mb-2"
            style={{ fontFamily: "'72Brand', sans-serif" }}>Regions</div>
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
            style={{ fontFamily: "'72Brand', sans-serif" }}>Offices</div>
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
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[#7C8896]"
              style={{ fontFamily: "'72Brand', sans-serif" }}>Badges</div>
            <button
              onClick={() => setShowAllBadges(v => !v)}
              className="text-[10px] font-medium"
              style={{ color: "#1B90FF" }}>
              {showAllBadges ? "Show earned" : `See all ${ALL_BADGES.length}`}
            </button>
          </div>
          {(() => {
            const earnedBadges = ALL_BADGES.filter((b, i) =>
              Array.isArray(user.badges) && user.badges.includes(BADGE_FULL_NAMES[i])
            );
            const visibleBadges = showAllBadges ? ALL_BADGES : earnedBadges;
            if (visibleBadges.length === 0) {
              return (
                <p className="text-xs text-[#7C8896]">
                  No badges yet — confirm a chat to earn your first one.
                </p>
              );
            }
            return (
              <div className="grid grid-cols-2 gap-1.5">
                {visibleBadges.map((b) => {
                  const i = ALL_BADGES.indexOf(b);
                  const earned = Array.isArray(user.badges) && user.badges.includes(BADGE_FULL_NAMES[i]);
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
                      <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg px-2.5 py-2 text-[10px] leading-snug pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
                        style={{ backgroundColor: "#000d24", color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>
                        {b.desc}
                        <div className="absolute top-full left-4 border-4 border-transparent" style={{ borderTopColor: "#000d24" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
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
  const limitReached = matchesLeft <= 0;
  const newRegion = suggestion && !currentUser.collectedRegions[suggestion.region];
  const newOffice  = suggestion && !currentUser.collectedOffices[suggestion.office];
  const used = MAX_MATCHES_PER_DAY - matchesLeft;

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
      <div className="flex-1 flex flex-col items-center justify-start px-7 py-5 gap-4 overflow-y-auto">

        {/* Match progress — numbered dots */}
        <div className="w-full flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {Array.from({ length: MAX_MATCHES_PER_DAY }).map((_, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="flex items-center justify-center rounded-full text-[10px] font-bold transition-all duration-300"
                  style={{
                    width: 22, height: 22,
                    backgroundColor: i < used ? "#1B90FF" : "#EAF5FF",
                    color: i < used ? "#fff" : "#7C8896",
                    border: `1.5px solid ${i < used ? "#1B90FF" : "#CFE6FA"}`,
                  }}>
                  {i < used ? <Check size={11} /> : i + 1}
                </div>
                {i < MAX_MATCHES_PER_DAY - 1 && (
                  <div className="w-4 h-px" style={{ backgroundColor: i < used - 1 ? "#1B90FF" : "#CFE6FA" }} />
                )}
              </div>
            ))}
            <span className="text-[10px] text-[#7C8896] font-mono ml-1">
              {limitReached ? "All matched today" : `Match ${used + 1} of ${MAX_MATCHES_PER_DAY}`}
            </span>
          </div>
          <div className="text-[10px] text-[#7C8896] font-mono shrink-0">
            {reshufflesLeft} reshuffle{reshufflesLeft === 1 ? "" : "s"}
          </div>
        </div>

        {/* Matcher card — lighter surface to contrast with dark nav */}
        {/* DESIGN JUDGMENT: switched from dark navy gradient to white card with blue border so the card
            reads as the primary action surface rather than blending into the header */}
        <div className="w-full rounded-2xl overflow-hidden"
          style={{
            backgroundColor: "#fff",
            boxShadow: "0 4px 24px rgba(0,32,96,0.10)",
            border: "1.5px solid #CFE6FA",
          }}>

          {/* Card top label */}
          <div className="flex items-center justify-center gap-2 py-2.5 border-b"
            style={{ borderColor: "#EAF5FF", backgroundColor: "#F5FAFF" }}>
            <Coffee size={13} color="#1B90FF" />
            <span className="text-xs font-semibold tracking-[0.18em] uppercase"
              style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
              SAP Next Gen Matcher
            </span>
            <Coffee size={13} color="#1B90FF" />
          </div>

          {/* Content window */}
          <div className="mx-4 my-3 rounded-xl overflow-hidden relative"
            style={{
              backgroundColor: "#F5FAFF",
              border: "1.5px solid #EAF5FF",
              minHeight: 180,
            }}>

            {limitReached ? (
              /* DESIGN JUDGMENT: replaced disabled accept button with a dedicated success state —
                 checkmark icon, positive messaging, spin button hidden since reshuffling for
                 tomorrow doesn't apply in this state */
              <div className="flex flex-col items-center text-center px-5 py-8 gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center mb-1"
                  style={{ backgroundColor: "#EAF5FF", border: "2px solid #89D1FF" }}>
                  <Check size={26} color="#1B90FF" />
                </div>
                <div className="text-sm font-semibold" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
                  You're all set for today
                </div>
                <div className="text-xs leading-relaxed" style={{ color: "#445063" }}>
                  You've sent {MAX_MATCHES_PER_DAY} match requests today. Head to{" "}
                  <span className="font-semibold" style={{ color: "#1B90FF" }}>Active Matches</span>{" "}
                  to schedule your chats and earn stamps.
                </div>
                <div className="text-[10px] mt-1 px-3 py-1.5 rounded-full"
                  style={{ color: "#7C8896", backgroundColor: "#EAF5FF" }}>
                  More matches available tomorrow
                </div>
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
                <div className="p-4 relative overflow-hidden flex flex-col items-center text-center gap-3">
                  <Avatar name={suggestion.name} email={suggestion.email} size={56} />
                  <div className="w-full">
                    <div className="font-semibold text-sm mb-0.5" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
                      {displayName(suggestion)}
                    </div>
                    <div className="text-xs text-[#5A6472] mb-2">{suggestion.role}</div>
                    <div className="flex flex-col items-center gap-1">
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
                  <div className="flex flex-wrap justify-center gap-1">
                    {newRegion && <Pill color="#DF1278">✦ New region</Pill>}
                    {newOffice  && <Pill color="#1B90FF">✦ New office</Pill>}
                    {suggestion.interests.slice(0, 3).map(i => (
                      <span key={i} className="text-[10px] rounded-full px-2 py-0.5"
                        style={{ backgroundColor: "#D1EFFF", color: "#002060" }}>{i}</span>
                    ))}
                  </div>
                  {Array.isArray(suggestion.badges) && suggestion.badges.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1">
                      {suggestion.badges.map(b => (
                        <span key={b} className="text-[10px] rounded-full px-2 py-0.5 font-medium"
                          style={{ backgroundColor: "#FFF0F7", color: "#DF1278", border: "1px solid #FFB3D1" }}>
                          🏅 {b}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Buttons row — only shown when there are matches left */}
          {!limitReached && (
            <div className="flex items-center justify-between px-4 pb-4 gap-3">
              <button
                  onClick={handleAccept}
                  disabled={!suggestion || spinning}
                  id="tutorial-accept-btn"
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#1B90FF", color: "#fff", boxShadow: "0 2px 8px rgba(27,144,255,0.3)" }}>
                <Check size={15} /> Accept match
              </button>

              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className="text-[9px] font-mono uppercase tracking-widest text-[#7C8896]">spin</div>
                <button
                  onClick={handleReshuffle}
                  disabled={spinning}
                  id="tutorial-spin-btn"
                  className={`relative flex items-center justify-center rounded-full transition-all disabled:cursor-not-allowed ${leverActive ? "spin-btn-go" : leverShaking ? "spin-btn-shake" : reshufflesLeft > 0 ? "spin-btn-pulse" : ""}`}
                  title={reshufflesLeft > 0 ? "Spin for a new match" : "No spins left"}
                  style={{
                    width: 52, height: 52,
                    backgroundColor: reshufflesLeft > 0 ? "#DF1278" : "#E8ECF0",
                    boxShadow: reshufflesLeft > 0 ? "0 4px 14px rgba(223,18,120,0.35)" : "none",
                    border: `2px solid ${reshufflesLeft > 0 ? "rgba(255,111,173,0.6)" : "#CFD8DC"}`,
                  }}>
                  <Shuffle size={22} color={reshufflesLeft > 0 ? "#fff" : "#AAB0B8"} />
                </button>
                <div className="flex gap-1">
                  {Array.from({ length: MAX_RESHUFFLES_PER_DAY }).map((_, i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                      style={{ backgroundColor: i < reshufflesLeft ? "#DF1278" : "#E0EAF5" }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

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
  const usersById = Object.fromEntries(users.map(u => [u.id, u]));

  // Matches expiring within 2 days that haven't been confirmed
  const urgentMatches = matches.filter(m =>
    (m.userAId === currentUser.id || m.userBId === currentUser.id) &&
    !m.removed && m.status === "active" &&
    Math.ceil((m.expiresAt - Date.now()) / 86400000) <= 2
  );

  function generateInvite(m, other, icebreaker) {
    const myName = displayName(currentUser);
    const theirName = displayName(other);
    const subject = `☕ Coffee Chat: ${myName} × ${theirName} | SAP Next Gen Connections Passport`;
    const appUrl = "https://sap-academy-sapacademy-cf-nextgen-space-connections-pas540e9191.cfapps.us10.hana.ondemand.com";
    const body = `Hi ${theirName.split(" ")[0]},

I'd love to connect for a 30-minute coffee chat as part of the SAP Next Gen Connections Passport program! 🌍

📋 Suggested agenda (30 min):
  • Quick intros — role, office, what you're working on
  • Open conversation — tips, resources, what you're excited about at SAP
  • Wrap up & swap any useful contacts or resources

📍 Location: Microsoft Teams
⏱ Duration: 30 minutes

---
🎖️ After our chat, please open the Connections Passport app and click "We met" on this match — both of us need to confirm to earn our passport stamps!

🔗 App: ${appUrl}

Looking forward to connecting,
${myName}
SAP Next Gen Connections Passport`;

    const teamsLink = `https://teams.microsoft.com/l/meeting/new?subject=${encodeURIComponent(subject)}&attendees=${encodeURIComponent(other.email || other.name)}&body=${encodeURIComponent(body)}`;
    return { subject, body, teamsLink };
  }

  const STATUS_RANK = { completed: 4, pending_confirmation: 3, active: 2, expired: 1 };

  const myMatches = (() => {
    const raw = matches.filter(m =>
      (m.userAId === currentUser.id || m.userBId === currentUser.id) && !m.removed
    );
    // Deduplicate by other-person ID: keep the match with the highest status rank
    const best = new Map();
    for (const m of raw) {
      const otherId = m.userAId === currentUser.id ? m.userBId : m.userAId;
      const prev = best.get(otherId);
      if (!prev || (STATUS_RANK[m.status] || 0) > (STATUS_RANK[prev.status] || 0)) {
        best.set(otherId, m);
      }
    }
    return Array.from(best.values());
  })();

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
    const isUrgent = m.status === "active" && daysLeft <= 2;

    return (
      <div className="mx-3 mb-2 rounded-2xl overflow-hidden"
        style={{ backgroundColor: "#fff", border: "1.5px solid #EAF5FF", boxShadow: "0 2px 8px rgba(0,32,96,0.06)" }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <Avatar name={other.name} email={other.email} size={32} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium truncate" style={{ color: "#002060" }}>{displayName(other)}</span>
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
                      ? `You've confirmed — waiting for ${displayName(other).split(" ")[0]} to do the same. Once they confirm, you'll both earn a passport stamp!`
                      : `${displayName(other).split(" ")[0]} has confirmed your chat. Click "We met" to confirm on your end and unlock your passport stamp!`
                    }</p>
                  </>}
                  {m.status === "completed" && <>
                    <div className="font-semibold mb-1.5" style={{ color: "#89D1FF" }}>🎉 Chat completed!</div>
                    <p>Congratulations — you and {displayName(other).split(" ")[0]} both confirmed this chat. Check your passport for your new stamp from <span className="font-semibold">{other.office}</span>!</p>
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

        {/* Schedule button — active matches only */}
        {m.status === "active" && (
          <div className="mx-4 mb-2 flex flex-wrap gap-2">
            <button
              onClick={() => window.open(generateInvite(m, other, null).teamsLink, "_blank")}
              className="flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1 transition-colors"
              style={{ backgroundColor: "#5059C9", color: "#fff", border: "1px solid #3B4AB8" }}>
              📅 Schedule in Teams
            </button>
          </div>
        )}


        {/* Post-chat notes removed */}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: "#fff" }}>
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

      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-2">
        {myMatches.length === 0 ? (
          <div className="mt-8 px-5 text-center">
            <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ backgroundColor: "#F5FAFF", border: "1.5px dashed #CFE6FA" }}>
              <Coffee size={18} color="#CFE6FA" />
            </div>
            <p className="text-xs font-medium mb-1" style={{ color: "#7C8896" }}>No matches yet</p>
            <p className="text-[10px] leading-relaxed" style={{ color: "#B0BFCC" }}>
              Accept a match on the left to get started. It will appear here once sent.
            </p>
          </div>
        ) : groups.map(g => {
          const inGroup = myMatches.filter(m => m.status === g.key);
          if (inGroup.length === 0) return null;
          return (
            <div key={g.key}>
              {/* Section label */}
              <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                <span className="text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: g.color, fontFamily: "'72Brand', sans-serif" }}>
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
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const collectedRegions = (user.collectedRegions && typeof user.collectedRegions === "object" && !Array.isArray(user.collectedRegions))
    ? user.collectedRegions : {};
  const collectedOffices = (user.collectedOffices && typeof user.collectedOffices === "object" && !Array.isArray(user.collectedOffices))
    ? user.collectedOffices : {};
  const regionEntries = Object.entries(collectedRegions).map(([k, v]) => [k, Number(v) || 0]);
  const officeEntries = Object.entries(collectedOffices).map(([k, v]) => [k, Number(v) || 0]);
  const totalStamps = regionEntries.reduce((s,[,c])=>s+c,0) + officeEntries.reduce((s,[,c])=>s+c,0);

  function handleShare() {
    const W = 800, H = 480;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0,   "#001642");
    grad.addColorStop(0.55,"#002060");
    grad.addColorStop(1,   "#0A3D8F");
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, W, H, 24);
    ctx.fill();

    // Subtle dot grid pattern
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let x = 20; x < W; x += 28) {
      for (let y = 20; y < H; y += 28) {
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Left accent bar
    const accent = ctx.createLinearGradient(0, 0, 0, H);
    accent.addColorStop(0, "#1B90FF"); accent.addColorStop(1, "#DF1278");
    ctx.fillStyle = accent;
    roundRect(ctx, 0, 0, 5, H, 0); ctx.fill();

    // SAP NEXT GEN label
    ctx.fillStyle = "#89D1FF";
    ctx.font = "bold 11px sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillText("SAP NEXT GEN  ·  CONNECTIONS PASSPORT", 36, 44);

    // Name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText(displayName(user), 36, 88);

    // Role · Office
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "15px sans-serif";
    ctx.fillText(`${user.role}  ·  ${user.office}`, 36, 114);

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(36, 132); ctx.lineTo(W - 36, 132); ctx.stroke();

    // Stats row
    const stats = [
      { label: "Chats", value: String(user.chatsCompleted || 0) },
      { label: "Regions", value: `${regionEntries.length}/${REGIONS.length}` },
      { label: "Offices", value: String(officeEntries.length) },
      { label: "Badges", value: String(Array.isArray(user.badges) ? user.badges.length : 0) },
    ];
    const statW = (W - 72) / stats.length;
    stats.forEach((s, i) => {
      const x = 36 + i * statW + statW / 2;
      ctx.fillStyle = "#1B90FF";
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.value, x, 168);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "10px sans-serif";
      ctx.fillText(s.label.toUpperCase(), x, 184);
    });
    ctx.textAlign = "left";

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath(); ctx.moveTo(36, 200); ctx.lineTo(W - 36, 200); ctx.stroke();

    // Region stamps row
    const REGION_COLORS_CANVAS = { EMEA: "#1B90FF", APAC: "#DF1278", NA: "#002060", MEE: "#7C3AED" };
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "9px sans-serif";
    ctx.fillText("REGIONS COLLECTED", 36, 222);

    const allRegions = ["EMEA","APAC","NA","MEE"];
    allRegions.forEach((r, i) => {
      const x = 36 + i * 90;
      const y = 230;
      const collected = collectedRegions[r] || 0;
      const color = collected ? REGION_COLORS_CANVAS[r] : "rgba(255,255,255,0.08)";
      ctx.fillStyle = color;
      roundRect(ctx, x, y, 76, 36, 8); ctx.fill();
      ctx.fillStyle = collected ? "#fff" : "rgba(255,255,255,0.2)";
      ctx.font = `bold 12px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(r, x + 38, y + 16);
      if (collected) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "9px sans-serif";
        ctx.fillText(`${collected} stamp${collected > 1 ? "s" : ""}`, x + 38, y + 28);
      }
      ctx.textAlign = "left";
    });

    // Badges section
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "9px sans-serif";
    ctx.fillText("BADGES EARNED", 36, 296);

    const badges = Array.isArray(user.badges) ? user.badges : [];
    if (badges.length === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.font = "11px sans-serif";
      ctx.fillText("No badges yet — complete your first chat to earn one!", 36, 318);
    } else {
      let bx = 36, by = 304;
      badges.slice(0, 8).forEach(b => {
        const label = `🏅 ${b}`;
        ctx.font = "11px sans-serif";
        const tw = ctx.measureText(label).width + 20;
        if (bx + tw > W - 36) { bx = 36; by += 28; }
        ctx.fillStyle = "rgba(223,18,120,0.25)";
        roundRect(ctx, bx, by, tw, 20, 10); ctx.fill();
        ctx.fillStyle = "#FFB3D1";
        ctx.fillText(label, bx + 10, by + 14);
        bx += tw + 8;
      });
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("SAP Next Gen Connections Passport  ·  sap.com/nextgen", W / 2, H - 18);
    ctx.textAlign = "left";

    // Download
    const link = document.createElement("a");
    link.download = `connections-passport-${(displayName(user) || "passport").replace(/\s+/g,"-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();

    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#EAF5FF" }}>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Passport cover header */}
        <div className="rounded-3xl overflow-hidden" style={{
          background: "linear-gradient(135deg, #001642 0%, #002060 55%, #0A3D8F 100%)",
          boxShadow: "0 8px 40px rgba(0,32,96,0.3)",
        }}>
          <div className="px-8 py-6 flex items-start justify-between">
            <div>
              <div className="text-xs tracking-[0.2em] uppercase mb-2 font-medium"
                style={{ color: "#89D1FF", fontFamily: "'72Brand', sans-serif" }}>
                SAP Next Gen · Digital Passport
              </div>
              <div className="text-2xl font-semibold text-white mb-1"
                style={{ fontFamily: "'72Brand', sans-serif" }}>
                {displayName(user)}
              </div>
              <div className="text-sm text-white">{user.role} · {user.office}</div>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <span style={{ fontSize: 36, lineHeight: 1 }}>{COUNTRY_EMOJI[user.country] || "🌐"}</span>
              </div>
              <div className="text-[10px] font-mono text-white opacity-80">{user.country}</div>
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95"
                style={{
                  backgroundColor: shareCopied ? "rgba(27,200,100,0.25)" : "rgba(255,255,255,0.12)",
                  color: shareCopied ? "#5DFFA0" : "#fff",
                  border: `1px solid ${shareCopied ? "rgba(93,255,160,0.4)" : "rgba(255,255,255,0.2)"}`,
                }}>
                {shareCopied ? <Check size={12} /> : <Share2 size={12} />}
                {shareCopied ? "Downloaded!" : "Share"}
              </button>
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
                <div className="text-xl font-semibold text-white" style={{ fontFamily: "'72Brand', sans-serif" }}>{s.value}</div>
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
              {REGIONS.filter(r => !collectedRegions[r]).map(r => (
                <div key={r} className="flex flex-col items-center justify-center rounded-xl p-3 gap-2"
                  style={{ minWidth: 90, minHeight: 110, border: "2px dashed #CFE6FA", opacity: 0.4 }}>
                  <Globe2 size={24} color="#7C8896" />
                  <div className="text-[10px] text-[#7C8896] text-center uppercase tracking-wide"
                    style={{ fontFamily: "'72Brand', sans-serif" }}>{r}</div>
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
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Award size={15} color="#002060" />
              <h2 className="text-sm font-semibold text-[#002060]">Milestone Badges</h2>
            </div>
            <button
              onClick={() => setShowAllBadges(v => !v)}
              className="text-xs font-medium"
              style={{ color: "#1B90FF" }}>
              {showAllBadges ? "Show earned" : `See all ${ALL_BADGES.length}`}
            </button>
          </div>
          {(() => {
            const earnedBadges = ALL_BADGES.filter((b, i) =>
              Array.isArray(user.badges) && user.badges.includes(BADGE_FULL_NAMES[i])
            );
            const visibleBadges = showAllBadges ? ALL_BADGES : earnedBadges;
            if (visibleBadges.length === 0) {
              return (
                <div className="rounded-2xl border-2 border-dashed p-8 text-center" style={{ borderColor: "#CFE6FA" }}>
                  <Award size={24} className="mx-auto mb-2" color="#CFE6FA" />
                  <p className="text-sm text-[#7C8896]">No badges yet — confirm a coffee chat to earn your first one.</p>
                </div>
              );
            }
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {visibleBadges.map((b) => {
                  const i = ALL_BADGES.indexOf(b);
                  const earned = Array.isArray(user.badges) && user.badges.includes(BADGE_FULL_NAMES[i]);
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
            );
          })()}
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
    preferredName: "",
    role: ROLES[0],
    office: ssoDefaults.office || OFFICES[0].office,
    country: ssoDefaults.country || OFFICES[0].country,
    region: ssoDefaults.region || OFFICES[0].region,
    interests: [],
  });
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
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
  const step2Valid = true; // interests are optional

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
            style={{ fontFamily: "'72Brand', sans-serif" }}>
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
              style={{ fontFamily: "'72Brand', sans-serif" }}>
              What's in it for you
            </div>
            <div className="space-y-2.5 text-xs text-white">
              <div className="flex gap-2.5"><span className="text-[#DF1278] font-bold shrink-0">01</span><span>Get matched with SAP Next Gen from across SAP's global offices and regions.</span></div>
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

            {/* Community Guidelines + Privacy — single card */}
            <div className="rounded-2xl bg-white p-6 space-y-5" style={{ border: "1px solid #CFE6FA" }}>
              <h2 className="font-semibold text-[#002060]" style={{ fontFamily: "'72Brand', sans-serif" }}>
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

              <div className="border-t pt-4 space-y-3" style={{ borderColor: "#EAF5FF" }}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={consent.guidelines}
                    onChange={e => setConsent(c => ({ ...c, guidelines: e.target.checked }))}
                    className="mt-0.5 shrink-0 accent-[#002060]" />
                  <span className="text-xs text-[#445063] leading-relaxed">
                    I agree to follow the Community Guidelines. <span className="text-[#DF1278] font-semibold">*</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={consent.dataProcessing}
                    onChange={e => setConsent(c => ({ ...c, dataProcessing: e.target.checked }))}
                    className="mt-0.5 shrink-0 accent-[#002060]" />
                  <span className="text-xs text-[#445063] leading-relaxed">
                    I have read and agree to the{" "}
                    <button onClick={() => setShowPrivacyModal(true)}
                      className="font-medium underline underline-offset-2"
                      style={{ color: "#1B90FF" }}>
                      Privacy &amp; Data Notice
                    </button>
                    . <span className="text-[#DF1278] font-semibold">*</span>
                  </span>
                </label>
              </div>
            </div>

            <button onClick={() => setStep(1)} disabled={!consentValid}
              className="w-full rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#002060", color: "#fff" }}>
              I agree — continue <ArrowRight size={15} />
            </button>

            {/* Privacy full notice modal */}
            {showPrivacyModal && (
              <div style={{
                position: "fixed", inset: 0, zIndex: 300,
                backgroundColor: "rgba(0,32,96,0.6)", backdropFilter: "blur(4px)",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
              }}>
                <div className="rounded-2xl bg-white w-full max-w-lg p-6 space-y-4 overflow-y-auto"
                  style={{ maxHeight: "80vh", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-[#002060]" style={{ fontFamily: "'72Brand', sans-serif" }}>
                      Privacy &amp; Data Notice
                    </h3>
                    <button onClick={() => setShowPrivacyModal(false)} style={{ color: "#7C8896" }}>
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-4 text-xs text-[#445063] leading-relaxed">
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
                            <span className="font-semibold text-[#002060]">{title}</span>
                          </div>
                          <p>{body}</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF" }}>
                      <p className="font-semibold text-[#002060]">Data retention</p>
                      <p>Your data is retained for the duration of the SAP Next Gen Connections Passport program or until you delete your account, whichever comes first.</p>
                    </div>
                    <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF" }}>
                      <p className="font-semibold text-[#002060]">Your rights</p>
                      <p>Under GDPR you have the right to access, rectify, erase, and port your data, and to object to processing. Contact <span className="font-semibold text-[#002060]">SAPnextgen@sap.com</span> to exercise these rights.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setShowPrivacyModal(false); setConsent(c => ({ ...c, dataProcessing: true })); }}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold"
                    style={{ backgroundColor: "#002060", color: "#fff" }}>
                    I have read this — close
                  </button>
                </div>
              </div>
            )}

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
                    <h3 className="font-semibold text-[#002060]" style={{ fontFamily: "'72Brand', sans-serif" }}>
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
            <h2 className="font-semibold text-[#002060]" style={{ fontFamily: "'72Brand', sans-serif" }}>
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
              <label className="text-xs font-semibold text-[#002060] block mb-1">
                Preferred first name <span className="font-normal text-[#7C8896]">(optional)</span>
              </label>
              <input value={form.preferredName || ""} onChange={e => update("preferredName", e.target.value)}
                placeholder={`e.g. ${(form.name || "Jordan").split(" ")[0]}`}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                style={{ borderColor: "#CFE6FA" }} />
              <p className="text-[11px] text-[#7C8896] mt-1">
                This is the name others will see on your match card and passport.
              </p>
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
              <label className="text-xs font-semibold text-[#002060] block mb-1">SAP Office <span className="font-normal text-[#7C8896]">(optional)</span></label>
              <select value={form.office} onChange={e => update("office", e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{ borderColor: "#CFE6FA" }}>
                <option value="">— Select your office —</option>
                {[...OFFICES].sort((a, b) => a.office.localeCompare(b.office)).map(o => <option key={o.office}>{o.office}</option>)}
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
              <h3 className="font-semibold text-[#002060] text-sm" style={{ fontFamily: "'72Brand', sans-serif" }}>
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
                  <h3 className="font-semibold text-[#002060]" style={{ fontFamily: "'72Brand', sans-serif" }}>
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
              <h2 className="font-semibold text-[#002060] mb-1" style={{ fontFamily: "'72Brand', sans-serif" }}>
                {editMode ? "Update your interests" : "Pick your interests"}
              </h2>
              <p className="text-xs text-[#7C8896] mb-5">
                Optional — choose up to 10 topics. We use these to find you more relevant matches and conversation starters.
                <span className="ml-2 font-medium" style={{ color: form.interests.length > 0 ? "#1B90FF" : "#7C8896" }}>
                  {form.interests.length}/10 selected
                </span>
              </p>

              <div className="space-y-5">
                {INTEREST_CATEGORIES.map(cat => (
                  <div key={cat.label}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-base">{cat.emoji}</span>
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#7C8896]"
                        style={{ fontFamily: "'72Brand', sans-serif" }}>
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
                      style={{ fontFamily: "'72Brand', sans-serif" }}>
                      Other
                    </span>
                  </div>
                  {/* Show previously saved custom interests as removable chips */}
                  {form.interests.filter(i => !INTEREST_POOL.includes(i)).length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2.5">
                      {form.interests.filter(i => !INTEREST_POOL.includes(i)).map(item => (
                        <button key={item} onClick={() => toggleInterest(item)}
                          className="rounded-full px-3.5 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all"
                          style={{ backgroundColor: "#002060", color: "#fff", border: "1.5px solid #002060" }}>
                          <span>✓</span>{item}<span style={{ marginLeft: 2, opacity: 0.7 }}>×</span>
                        </button>
                      ))}
                    </div>
                  )}
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
              <h2 className="font-semibold text-[#002060] mb-4" style={{ fontFamily: "'72Brand', sans-serif" }}>
                {editMode ? "Review your changes" : "Review your profile"}
              </h2>

              <div className="flex items-center gap-4 mb-5 pb-5 border-b" style={{ borderColor: "#EAF5FF" }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold shrink-0"
                  style={{ backgroundColor: "#D1EFFF", color: "#002060" }}>
                  {form.name.split(" ").map(p => p[0]).slice(0,2).join("")}
                </div>
                <div>
                  <div className="font-semibold text-[#002060]" style={{ fontFamily: "'72Brand', sans-serif" }}>
                    {form.preferredName && form.preferredName.trim() ? form.preferredName.trim() : form.name}
                    {form.preferredName && form.preferredName.trim() && (
                      <span className="ml-2 text-[10px] font-normal text-[#7C8896]">({form.name})</span>
                    )}
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
                {editMode ? <><Check size={15} /> Save changes</> : <><Coffee size={15} /> Apply for a Connections Passport</>}
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
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-14">

        {/* Hero */}
        <div className="text-center space-y-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-1"
            style={{ backgroundColor: "#002060" }}>
            <Coffee size={26} color="#DF1278" />
          </div>
          <h1 className="text-4xl font-semibold text-[#002060] leading-tight"
            style={{ fontFamily: "'72Brand', sans-serif" }}>
            Meet your next colleague.<br />Anywhere in the world.
          </h1>
          <p className="text-base leading-relaxed max-w-md mx-auto" style={{ color: "#445063" }}>
            30-minute coffee chats with SAP Next Gen talent across every office and region. Collect stamps, earn badges, grow your global network.
          </p>
          {ssoUser ? (
            <div className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium"
              style={{ backgroundColor: "#fff", color: "#002060", border: "1px solid #CFE6FA", boxShadow: "0 2px 8px rgba(0,32,96,0.08)" }}>
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Signed in as {ssoUser.name} ·{" "}
              <button onClick={onJoin} className="font-semibold" style={{ color: "#DF1278" }}>Apply for a Connections Passport →</button>
            </div>
          ) : (
            <button onClick={onJoin}
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 font-semibold text-sm"
              style={{ backgroundColor: "#DF1278", color: "#fff", boxShadow: "0 4px 18px rgba(223,18,120,0.35)" }}>
              <LogIn size={16} /> Sign in with SAP
            </button>
          )}
        </div>

        {/* How it works — 3 steps */}
        <div>
          <div className="text-center mb-6">
            <span className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "#7C8896", fontFamily: "'72Brand', sans-serif" }}>
              How it works
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { emoji: "🎰", step: "01", title: "Get matched", body: "Spin the matcher to find someone new from a different office or region." },
              { emoji: "☕", step: "02", title: "Have a chat", body: "Schedule 30 minutes over Teams or in person. Use the built-in invite tool." },
              { emoji: "🎖️", step: "03", title: "Earn stamps", body: "Both confirm the chat and earn a passport stamp. Collect them all." },
            ].map(({ emoji, step, title, body }) => (
              <div key={step} className="rounded-2xl p-5 text-center space-y-2"
                style={{ backgroundColor: "#fff", border: "1px solid #CFE6FA", boxShadow: "0 2px 8px rgba(0,32,96,0.04)" }}>
                <div className="text-2xl mb-1">{emoji}</div>
                <div className="text-[10px] font-bold tracking-widest uppercase"
                  style={{ color: "#DF1278", fontFamily: "'72Brand', sans-serif" }}>{step}</div>
                <div className="font-semibold text-sm" style={{ color: "#002060" }}>{title}</div>
                <p className="text-xs leading-relaxed" style={{ color: "#5A6472" }}>{body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* What you collect — compact visual */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "linear-gradient(135deg, #001642 0%, #002060 60%, #0A3D8F 100%)", boxShadow: "0 8px 32px rgba(0,32,96,0.2)" }}>
          <div className="px-7 py-6 flex items-center justify-between border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase font-medium mb-1.5"
                style={{ color: "#89D1FF", fontFamily: "'72Brand', sans-serif" }}>
                SAP Next Gen · Digital Passport
              </div>
              <div className="text-xl font-semibold text-white" style={{ fontFamily: "'72Brand', sans-serif" }}>
                Your Name Here
              </div>
              <div className="text-xs text-white opacity-60 mt-0.5">iXp Intern · Berlin</div>
            </div>
            <div className="flex items-center gap-4">
              {[
                { label: "Chats", value: "12" },
                { label: "Regions", value: "3/4" },
                { label: "Badges", value: "5" },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className="text-2xl font-semibold text-white" style={{ fontFamily: "'72Brand', sans-serif" }}>{s.value}</div>
                  <div className="text-[10px] text-white opacity-50">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Region + badge preview row */}
          <div className="px-7 py-5 flex items-center justify-between gap-6">
            <div>
              <div className="text-[9px] uppercase tracking-widest mb-2.5"
                style={{ color: "rgba(137,209,255,0.5)", fontFamily: "'72Brand', sans-serif" }}>Stamps collected</div>
              <div className="flex gap-2">
                {[
                  { label: "EMEA", bg: "#1B90FF", text: "#fff" },
                  { label: "APAC", bg: "#89D1FF", text: "#002060" },
                  { label: "NA",   bg: "#DF1278", text: "#fff" },
                  { label: "MEE",  bg: null, text: "#89D1FF" },
                ].map(r => (
                  <div key={r.label}
                    className="flex items-center justify-center rounded-lg text-[10px] font-bold"
                    style={{
                      width: 48, height: 52,
                      backgroundColor: r.bg || "transparent",
                      border: r.bg ? "none" : "2px dashed rgba(255,255,255,0.15)",
                      color: r.text,
                      opacity: r.bg ? 1 : 0.35,
                      fontFamily: "'72Brand', sans-serif",
                      transform: `rotate(${r.label === "EMEA" ? -2 : r.label === "APAC" ? 1 : r.label === "NA" ? -1 : 2}deg)`,
                    }}>
                    {r.label}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest mb-2.5"
                style={{ color: "rgba(137,209,255,0.5)", fontFamily: "'72Brand', sans-serif" }}>Badges earned</div>
              <div className="flex gap-2">
                {[Coffee, Globe2, Globe2, Building2, Award, Sparkles].map((Icon, i) => (
                  <div key={i} className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: i < 4 ? "rgba(27,144,255,0.25)" : "rgba(255,255,255,0.06)", border: i < 4 ? "1px solid rgba(27,144,255,0.4)" : "1px solid rgba(255,255,255,0.1)" }}>
                    <Icon size={13} color={i < 4 ? "#89D1FF" : "rgba(255,255,255,0.2)"} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center space-y-3 pb-4">
          <p className="text-sm" style={{ color: "#7C8896" }}>Ready to start collecting stamps?</p>
          <button onClick={onJoin}
            className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 font-semibold text-sm"
            style={{ backgroundColor: "#002060", color: "#fff", boxShadow: "0 4px 14px rgba(0,32,96,0.25)" }}>
            {ssoUser ? <><ArrowRight size={16} /> Apply for a Connections Passport</> : <><LogIn size={16} /> Sign in with SAP</>}
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
              <div className="text-base font-semibold" style={{ fontFamily: "'72Brand', sans-serif", color: "#002060" }}>{value}</div>
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
              style={{ fontFamily: "'72Brand', sans-serif" }}>
              New Connection Request
            </span>
          </div>

          <div className="flex items-center gap-4 mb-5">
            <Avatar name={matchedUser.name} email={matchedUser.email} size={56} />
            <div>
              <div className="font-semibold text-white text-base"
                style={{ fontFamily: "'72Brand', sans-serif" }}>
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
            style={{ color: "#DF1278", fontFamily: "'72Brand', sans-serif" }}>
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

/* ── Tutorial Overlay ──────────────────────────────────────────────────────── */

const TUTORIAL_STEPS = [
  {
    icon: Stamp,
    title: "Welcome to your Passport",
    body: "This is your personal Connections Passport. Every coffee chat you complete earns a stamp — collect them from different regions and offices around the world.",
    targetId: null,
  },
  {
    icon: Shuffle,
    title: "Spin to find a match",
    body: "Hit the pink spin button to get a suggested colleague. You can reshuffle up to 3 times a day if you'd like a different suggestion.",
    targetId: "tutorial-spin-btn",
  },
  {
    icon: Check,
    title: "Accept a match",
    body: "When you find someone you'd like to meet, click Accept match. You can accept up to 3 matches per day.",
    targetId: "tutorial-accept-btn",
  },
  {
    icon: Coffee,
    title: "Have your chat & confirm",
    body: "Schedule a 30-minute chat using the Schedule in Teams button. After you've met, click We met — both of you need to confirm to earn your stamps.",
    targetId: "tutorial-matches-panel",
  },
  {
    icon: Award,
    title: "Track your progress",
    body: "Head to the My Passport tab any time to see your stamps, badges, and how many regions and offices you've collected. Good luck — and happy connecting!",
    targetId: "tutorial-passport-tab",
  },
];

function TutorialOverlay({ onClose }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const total = TUTORIAL_STEPS.length;
  const s = TUTORIAL_STEPS[step];
  const Icon = s.icon;
  const PAD = 10;

  // Measure the target element whenever the step changes
  React.useEffect(() => {
    if (!s.targetId) { setTargetRect(null); return; }
    const el = document.getElementById(s.targetId);
    if (!el) { setTargetRect(null); return; }
    const r = el.getBoundingClientRect();
    setTargetRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step, s.targetId]);

  function finish() {
    localStorage.setItem("cp-tutorial-done", "1");
    onClose();
  }

  // Card position: below target if there's room, otherwise centered
  const cardStyle = targetRect
    ? {
        position: "fixed",
        top: Math.min(targetRect.top + targetRect.height + 16, window.innerHeight - 320),
        left: Math.max(16, Math.min(targetRect.left, window.innerWidth - 384 - 16)),
        width: 360,
        zIndex: 60,
      }
    : {
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 360,
        zIndex: 60,
      };

  return (
    <div className="fixed inset-0" style={{ zIndex: 50 }}>
      {/* Dark overlay with cutout for highlighted element */}
      {targetRect ? (
        <>
          {/* Top */}
          <div className="absolute" style={{ top: 0, left: 0, right: 0, height: targetRect.top, backgroundColor: "rgba(0,22,66,0.75)" }} />
          {/* Left */}
          <div className="absolute" style={{ top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height, backgroundColor: "rgba(0,22,66,0.75)" }} />
          {/* Right */}
          <div className="absolute" style={{ top: targetRect.top, left: targetRect.left + targetRect.width, right: 0, height: targetRect.height, backgroundColor: "rgba(0,22,66,0.75)" }} />
          {/* Bottom */}
          <div className="absolute" style={{ top: targetRect.top + targetRect.height, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,22,66,0.75)" }} />
          {/* Highlight ring */}
          <div className="absolute pointer-events-none" style={{
            top: targetRect.top, left: targetRect.left,
            width: targetRect.width, height: targetRect.height,
            borderRadius: 16,
            boxShadow: "0 0 0 3px #1B90FF, 0 0 24px rgba(27,144,255,0.5)",
          }} />
        </>
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,22,66,0.7)", backdropFilter: "blur(4px)" }} />
      )}

      {/* Card */}
      <div style={{ ...cardStyle, borderRadius: 24, backgroundColor: "#fff", boxShadow: "0 24px 64px rgba(0,32,96,0.35)", overflow: "hidden" }}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, #001642 0%, #002060 100%)" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase" style={{ color: "#89D1FF" }}>
              Getting started · {step + 1} of {total}
            </span>
            <button onClick={finish} style={{ color: "rgba(255,255,255,0.4)" }}><X size={16} /></button>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300"
                style={{ backgroundColor: i <= step ? "#1B90FF" : "rgba(255,255,255,0.15)" }} />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "#EAF5FF" }}>
            <Icon size={28} color="#002060" />
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-2" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
              {s.title}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "#445063" }}>{s.body}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button onClick={() => setStep(s => s - 1)} disabled={step === 0}
            className="flex items-center gap-1.5 text-sm font-medium rounded-full px-4 py-2 disabled:opacity-0 transition-opacity"
            style={{ color: "#445063", backgroundColor: "#F5FAFF", border: "1px solid #CFE6FA" }}>
            <ArrowLeft size={14} /> Back
          </button>
          {step < total - 1 ? (
            <button onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1.5 text-sm font-semibold rounded-full px-5 py-2"
              style={{ backgroundColor: "#1B90FF", color: "#fff" }}>
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button onClick={finish}
              className="flex items-center gap-1.5 text-sm font-semibold rounded-full px-5 py-2"
              style={{ backgroundColor: "#DF1278", color: "#fff" }}>
              Let's go! <Sparkles size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Feedback Button ───────────────────────────────────────────────────────── */

function FeedbackButton() {
  const subject = encodeURIComponent("Connections Passport — Feedback");
  const body = encodeURIComponent("Hi SAP Next Gen E2E Team,\n\n\n\nThank you.");
  const href = `mailto:SAPnextgen@sap.com?subject=${subject}&body=${body}`;

  return (
    <a
      href={href}
      title="Share feedback"
      className="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
      style={{ backgroundColor: "#0A3D8F", color: "#fff", textDecoration: "none" }}>
      <span style={{ fontSize: 15, lineHeight: 1 }}>💬</span>
    </a>
  );
}

/* =====================================================================
   DEMO MODE — Guided tour for All Employee Meeting presentations.
   Accessible via Admin panel → "Demo Mode" tab.
   Isolated state: never touches liveUser / demoUsers in the parent app.
   ===================================================================== */

const DEMO_PERSONA = {
  id: "demo-alex", email: "alex.kim@sap.com",
  name: "Alex Kim", role: "STAR Student",
  office: "Berlin", country: "Germany", region: "EMEA",
  timezone: "CET",
  interests: ["Sustainability", "Product Design", "AI & ML"],
  optedIn: true, paused: false, deleted: false, consentGiven: true,
  // Pre-seeded with 1 prior chat so passport step shows something interesting
  collectedRegions: { "APAC": 1 },
  collectedOffices: { "Tokyo": 1 },
  chatsCompleted: 1,
  badges: ["First Connection"],
  reshufflesUsedToday: 0, matchesAcceptedToday: 0,
  lastReshuffleDate: null, lastMatchAcceptDate: null,
};

const DEMO_STEPS = [
  {
    view: "signup", signupStep: 0,
    title: "Step 1 of 7 — Signing up",
    body: "The first thing a new member sees is the Community Guidelines and Privacy & Data Notice. Both must be acknowledged before any profile data is stored.",
  },
  {
    view: "signup", signupStep: 1,
    title: "Step 2 of 7 — Your profile",
    body: "Members set their name, role, and SAP office. Region is auto-detected. This is the card your match will see when the matcher suggests you.",
  },
  {
    view: "signup", signupStep: 2,
    title: "Step 3 of 7 — Interests",
    body: "Choose up to 10 interests from curated categories. These appear on your match card as conversation starters before the chat even begins.",
  },
  {
    view: "dashboard", highlight: "matcher",
    title: "Step 4 of 7 — Finding a match",
    body: "The matcher suggests a colleague from a different region or office. Hit the pink Spin button for a new suggestion, or Accept to send a coffee chat request. Up to 3 matches per day.",
  },
  {
    view: "dashboard", highlight: "matches",
    title: "Step 5 of 7 — Active matches",
    body: "Accepted matches live here with a 7-day window. A meeting invite template with a Teams link is auto-generated. Both people must click 'We met' after the chat to confirm.",
  },
  {
    view: "dashboard", highlight: "stamps", autoConfirm: true,
    title: "Step 6 of 7 — Earning stamps",
    body: "When both users confirm, stamps are awarded from the other person's region and office. Milestones unlock badges. Watch — a stamp just landed on Alex's passport!",
  },
  {
    view: "passport",
    title: "Step 7 of 7 — Your passport",
    body: "Every completed chat becomes a stamp. Collect regions, offices, and milestone badges as you grow your global SAP Next Gen network. Tap Share to copy your stats.",
  },
];

function DemoMode({ onExit, seedUsers: peerUsers }) {
  const [stepIdx, setStepIdx]     = useState(0);
  const [demoUser, setDemoUser]   = useState(DEMO_PERSONA);
  const [celebrating, setCelebrating] = useState(false);
  const stampFired = React.useRef(false);

  const step = DEMO_STEPS[stepIdx];
  const total = DEMO_STEPS.length;

  // The match partner for steps 5–7 (Amara Nakamura, APAC/Tokyo from seed pool)
  const matchPartner = peerUsers.find(u => u.office === "Tokyo") || peerUsers[2] || peerUsers[0];

  // Active match used in steps 5–6
  const [demoMatch, setDemoMatch] = useState({
    id: "demo-m1",
    userAId: DEMO_PERSONA.id, userBId: matchPartner?.id,
    userAEmail: DEMO_PERSONA.email, userBEmail: matchPartner?.email,
    status: "active",
    confirmedA: false, confirmedB: false,
    acknowledgedByB: true, removed: false,
    createdAt: Date.now() - 86400000,
    expiresAt: Date.now() + 6 * 86400000,
  });

  // Fire stamp award once when step 6 (autoConfirm) is reached
  React.useEffect(() => {
    if (!step.autoConfirm) return;
    if (stampFired.current) return;
    stampFired.current = true;
    setTimeout(() => {
      // Complete the match
      setDemoMatch(m => ({ ...m, status: "completed", confirmedA: true, confirmedB: true }));
      // Award stamps to demoUser
      setDemoUser(u => {
        const clone = {
          ...u,
          collectedRegions: { ...u.collectedRegions },
          collectedOffices: { ...u.collectedOffices },
        };
        if (matchPartner) awardStamps(clone, matchPartner);
        recalcBadges(clone);
        return clone;
      });
      setCelebrating(true);
      playStampSound();
    }, 600);
  }, [step.autoConfirm]);

  function goNext() {
    if (stepIdx < total - 1) setStepIdx(i => i + 1);
  }
  function goPrev() {
    if (stepIdx > 0) setStepIdx(i => i - 1);
  }

  // All users visible to the demo matcher = seed users (excluding Alex)
  const matcherPeers = peerUsers.filter(u => u.id !== DEMO_PERSONA.id);
  const allDemoUsers = [demoUser, ...matcherPeers];
  const allDemoMatches = [demoMatch];

  // ── Render helpers for each view ────────────────────────────────────────────

  function renderSignupStep() {
    const s = step.signupStep;

    if (s === 0) {
      // Consent page replica
      return (
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-8 px-4" style={{ backgroundColor: "#EAF5FF" }}>
          <div className="w-full max-w-md space-y-4">
            <div className="text-center mb-2">
              <div className="text-xs tracking-[0.18em] uppercase font-medium mb-1" style={{ color: "#1B90FF", fontFamily: "'72Brand', sans-serif" }}>SAP Next Gen</div>
              <div className="text-xl font-semibold" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>Privacy &amp; Consent</div>
            </div>
            <div className="rounded-2xl bg-white p-6 space-y-5" style={{ border: "1px solid #CFE6FA" }}>
              <h2 className="font-semibold text-[#002060]" style={{ fontFamily: "'72Brand', sans-serif" }}>Community Guidelines</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { emoji: "🤝", rule: "Be respectful", detail: "Professional, inclusive behaviour only." },
                  { emoji: "📅", rule: "Show up", detail: "Schedule your chat within the 7-day window." },
                  { emoji: "✅", rule: "Be honest", detail: "Only confirm a chat once it's actually happened." },
                  { emoji: "🚩", rule: "Report issues", detail: "Report misuse directly to the SAP Next Gen E2E team." },
                ].map(({ emoji, rule, detail }) => (
                  <div key={rule} className="rounded-xl p-3 space-y-1" style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF" }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{emoji}</span>
                      <span className="text-xs font-semibold text-[#002060]">{rule}</span>
                    </div>
                    <p className="text-xs text-[#445063] leading-relaxed">{detail}</p>
                  </div>
                ))}
              </div>
              <div className="border-t pt-4 space-y-3" style={{ borderColor: "#EAF5FF" }}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" readOnly checked className="mt-0.5 shrink-0 accent-[#002060]" />
                  <span className="text-xs text-[#445063]">I agree to follow the Community Guidelines. <span className="text-[#DF1278] font-semibold">*</span></span>
                </label>
                <label className="flex items-start gap-3">
                  <input type="checkbox" readOnly checked className="mt-0.5 shrink-0 accent-[#002060]" />
                  <span className="text-xs text-[#445063]">I have read and agree to the <span className="font-medium underline" style={{ color: "#1B90FF" }}>Privacy &amp; Data Notice</span>. <span className="text-[#DF1278] font-semibold">*</span></span>
                </label>
              </div>
            </div>
            <button className="w-full rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2" style={{ backgroundColor: "#002060", color: "#fff" }}>
              I agree — continue <ArrowRight size={15} />
            </button>
          </div>
        </div>
      );
    }

    if (s === 1) {
      // Profile form replica (pre-filled with Alex Kim)
      return (
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-8 px-4" style={{ backgroundColor: "#EAF5FF" }}>
          <div className="w-full max-w-md space-y-4">
            <div className="text-center mb-2">
              <div className="text-xs tracking-[0.18em] uppercase font-medium mb-1" style={{ color: "#1B90FF", fontFamily: "'72Brand', sans-serif" }}>Step 2 of 4</div>
              <div className="text-xl font-semibold" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>Tell us about yourself</div>
            </div>
            <div className="rounded-2xl bg-white p-6 space-y-4" style={{ border: "1px solid #CFE6FA" }}>
              {[
                { label: "Full name", value: DEMO_PERSONA.name },
                { label: "Role", value: DEMO_PERSONA.role },
                { label: "Office", value: `${DEMO_PERSONA.office}, ${DEMO_PERSONA.country}` },
                { label: "Region (auto-detected)", value: DEMO_PERSONA.region },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: "#7C8896", fontFamily: "'72Brand', sans-serif" }}>{label}</div>
                  <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF", color: "#002060" }}>{value}</div>
                </div>
              ))}
            </div>
            <button className="w-full rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2" style={{ backgroundColor: "#002060", color: "#fff" }}>
              Next <ArrowRight size={15} />
            </button>
          </div>
        </div>
      );
    }

    if (s === 2) {
      // Interests replica (pre-selected chips)
      return (
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-8 px-4" style={{ backgroundColor: "#EAF5FF" }}>
          <div className="w-full max-w-md space-y-4">
            <div className="text-center mb-2">
              <div className="text-xs tracking-[0.18em] uppercase font-medium mb-1" style={{ color: "#1B90FF", fontFamily: "'72Brand', sans-serif" }}>Step 3 of 4</div>
              <div className="text-xl font-semibold" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>Pick your interests</div>
              <p className="text-xs mt-1" style={{ color: "#7C8896" }}>Choose 2–10 topics you'd love to chat about</p>
            </div>
            <div className="rounded-2xl bg-white p-6 space-y-4" style={{ border: "1px solid #CFE6FA" }}>
              {INTEREST_CATEGORIES.map(cat => (
                <div key={cat.label}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-2 flex items-center gap-1.5" style={{ color: "#7C8896", fontFamily: "'72Brand', sans-serif" }}>
                    <span>{cat.emoji}</span>{cat.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.items.map(item => {
                      const selected = DEMO_PERSONA.interests.includes(item);
                      return (
                        <span key={item} className="text-[11px] rounded-full px-2.5 py-1 font-medium"
                          style={{
                            backgroundColor: selected ? "#002060" : "#F5FAFF",
                            color: selected ? "#fff" : "#445063",
                            border: `1px solid ${selected ? "#002060" : "#EAF5FF"}`,
                          }}>
                          {item}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return null;
  }

  function renderDashboard() {
    const hl = step.highlight;
    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Identity strip */}
        <div className="shrink-0 px-6 py-4 border-b flex items-center gap-6"
          style={{ backgroundColor: "#fff", borderColor: "#CFE6FA" }}>
          <div className="flex items-center gap-3">
            <Avatar name={demoUser.name} email={demoUser.email} size={44} />
            <div>
              <div className="font-semibold text-sm" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>{demoUser.name}</div>
              <div className="text-xs" style={{ color: "#7C8896" }}>{demoUser.role} · {demoUser.office}</div>
            </div>
          </div>
          <div className="h-8 w-px mx-2" style={{ backgroundColor: "#EAF5FF" }} />
          <div className="flex items-center gap-3">
            {[
              { label: "Chats completed", value: demoUser.chatsCompleted || 0, color: "#1B90FF" },
              { label: "Regions collected", value: `${Object.keys(demoUser.collectedRegions || {}).length} / 4`, color: "#DF1278" },
              { label: "Offices collected", value: Object.keys(demoUser.collectedOffices || {}).length, color: "#002060" },
              { label: "Badges earned", value: (Array.isArray(demoUser.badges) ? demoUser.badges : []).length, color: "#7C3AED" },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center justify-center rounded-xl px-5 py-2.5"
                style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF", minWidth: 90 }}>
                <span className="text-xl font-semibold leading-none" style={{ color: s.color, fontFamily: "'72Brand', sans-serif" }}>{s.value}</span>
                <span className="text-[10px] mt-1 text-center leading-tight" style={{ color: "#7C8896" }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Two panels */}
        <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: "1fr 420px" }}>
          {/* Left — MatchPanel */}
          <div className="border-r overflow-hidden flex flex-col transition-opacity duration-300"
            style={{
              borderColor: "#CFE6FA",
              opacity: hl === "matches" ? 0.45 : 1,
              boxShadow: hl === "matcher" ? "inset 0 0 0 3px #1B90FF" : "none",
              borderRadius: hl === "matcher" ? "0" : undefined,
            }}>
            <MatchPanel
              users={allDemoUsers}
              matches={allDemoMatches}
              currentUser={demoUser}
              onAccept={() => {}}
              onReshuffle={() => {}}
              reshufflesLeft={3}
              matchesLeft={3}
            />
          </div>

          {/* Right — MatchesPanel */}
          <div className="overflow-hidden border-l transition-opacity duration-300"
            style={{
              backgroundColor: "#fff", borderColor: "#CFE6FA",
              opacity: hl === "matcher" ? 0.45 : 1,
              boxShadow: (hl === "matches" || hl === "stamps") ? "inset 0 0 0 3px #1B90FF" : "none",
            }}>
            <MatchesPanel
              matches={allDemoMatches}
              users={allDemoUsers}
              currentUser={demoUser}
              onConfirm={() => {}}
              onRemove={() => {}}
              onAcknowledge={() => {}}
            />
          </div>
        </div>

        {celebrating && <StampCelebration onDone={() => setCelebrating(false)} />}
      </div>
    );
  }

  function renderPassport() {
    return <PassportPage user={demoUser} />;
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden relative" style={{ backgroundColor: "#EAF5FF" }}>

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col" style={{ paddingBottom: 110 }}>
        {step.view === "signup"    && renderSignupStep()}
        {step.view === "dashboard" && renderDashboard()}
        {step.view === "passport"  && renderPassport()}
      </div>

      {/* Narrator card — fixed bottom-center */}
      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        width: "min(500px, calc(100% - 32px))", zIndex: 50,
        backgroundColor: "#001642",
        borderRadius: 20, border: "1.5px solid #1B90FF",
        boxShadow: "0 8px 40px rgba(0,22,66,0.65)",
        padding: "16px 20px",
      }}>
        {/* Progress bar */}
        <div className="flex gap-1 mb-3">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300"
              style={{ backgroundColor: i <= stepIdx ? "#1B90FF" : "rgba(255,255,255,0.12)" }} />
          ))}
        </div>

        {/* Title */}
        <div className="text-sm font-semibold mb-1" style={{ color: "#fff", fontFamily: "'72Brand', sans-serif" }}>
          {step.title}
        </div>

        {/* Body */}
        <div className="text-[11px] leading-relaxed mb-4" style={{ color: "#89D1FF" }}>
          {step.body}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={goPrev}
            disabled={stepIdx === 0}
            className="flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 transition-opacity disabled:opacity-0"
            style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#89D1FF", border: "1px solid rgba(255,255,255,0.12)" }}>
            <ArrowLeft size={12} /> Prev
          </button>

          <button
            onClick={onExit}
            className="text-[10px] font-medium"
            style={{ color: "rgba(137,209,255,0.5)" }}>
            Exit demo
          </button>

          {stepIdx < total - 1 ? (
            <button
              onClick={goNext}
              className="flex items-center gap-1.5 text-xs font-semibold rounded-full px-4 py-1.5"
              style={{ backgroundColor: "#1B90FF", color: "#fff" }}>
              Next <ArrowRight size={12} />
            </button>
          ) : (
            <button
              onClick={onExit}
              className="flex items-center gap-1.5 text-xs font-semibold rounded-full px-4 py-1.5"
              style={{ backgroundColor: "#DF1278", color: "#fff" }}>
              Finish <Sparkles size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GoodbyePage({ onContinue }) {
  React.useEffect(() => {
    const t = setTimeout(onContinue, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8"
      style={{ backgroundColor: "#EAF5FF" }}>
      <div className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ backgroundColor: "#fff", border: "2px solid #CFE6FA", boxShadow: "0 4px 20px rgba(0,32,96,0.10)" }}>
        <Coffee size={28} color="#002060" />
      </div>
      <div className="text-center space-y-2">
        <div className="text-2xl font-semibold" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
          See you around
        </div>
        <p className="text-sm max-w-xs leading-relaxed" style={{ color: "#7C8896" }}>
          Your account has been deleted. All stamps, badges, and match history have been cleared.
        </p>
      </div>
      <div className="text-xs" style={{ color: "#AAB8C8" }}>Redirecting to sign up…</div>
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
  const [adminTab, setAdminTab] = useState("dashboard");
  const [view, setView] = useState("landing");
  const [signedUpIds, setSignedUpIds] = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [celebrating, setCelebrating] = useState(false);
  const [ssoUser, setSsoUser] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);

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
        if (state.user && !state.user.deleted) {
          const u = normalizeUser(state.user);
          setLiveUser(u);
          setCurrentUserId(u.email);
          setSignedUpIds(prev => new Set([...prev, u.email]));
          setView("dashboard"); // returning user — skip landing/signup
        }
        // deleted user → liveUser stays null, view stays signup
        setLiveMatches(state.matches || []);
        setLivePeers((state.peers || []).map(normalizeUser));
      })
      .catch(() => setBackendAvailable(false));
  }, [ssoUser?.email]);

  // ── Background polling — refresh state every 30s so incoming matches appear ──
  React.useEffect(() => {
    if (!backendAvailable || !ssoUser?.email) return;
    const id = setInterval(() => {
      API.getMyState()
        .then(state => {
          if (!state) return;
          if (state.user && !state.user.deleted) {
            setLiveUser(normalizeUser(state.user));
          }
          setLiveMatches(state.matches || []);
          setLivePeers((state.peers || []).map(normalizeUser));
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [backendAvailable, ssoUser?.email]);

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
        pushNotif("☕ New coffee match!", `You've been matched with ${displayName(otherUser)} from ${otherUser.office}. Say hello!`);
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
        pushNotif("☕ New coffee match!", `You've been matched with ${displayName(otherUser)} from ${otherUser.office}. Say hello!`);
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
      setLiveUser(null);
      setLiveMatches([]);
      setLivePeers([]);
    } else {
      setDemoUsers(users => users.map(u => u.id === currentUserId
        ? { ...u, deleted: true, name: "SAP Next Gen Member", optedIn: false } : u));
      setDemoMatches(matches => matches.map(m =>
        (m.userAId === currentUserId || m.userBId === currentUserId) &&
        ["active", "pending_confirmation"].includes(m.status)
          ? { ...m, status: "expired" } : m
      ));
    }
    setSignedUpIds(new Set());
    setCurrentUserId(null);
    localStorage.removeItem("cp-tutorial-done");
    setView("goodbye");
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
      <div className="flex items-center justify-between px-6 py-2.5 border-b shrink-0"
        style={{ backgroundColor: "#002060", borderColor: "#001642" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: "#DF1278" }}>
            <Coffee size={14} color="#fff" />
          </div>
          <span className="text-white font-semibold text-sm tracking-tight"
            style={{ fontFamily: "'72Brand', sans-serif" }}>
            SAP Next Gen Connections Passport
          </span>
        </div>
        {/* Nav tabs — only shown after signup */}
        {hasSignedUp && (
        <div className="hidden sm:flex items-center gap-1 rounded-full p-1"
          style={{ backgroundColor: "#001642" }}>
          {["dashboard","passport","signup"].map(v => {
            const profileIncomplete = v === "signup" && currentUser && (
              !currentUser.office || !currentUser.interests || currentUser.interests.length === 0
            );
            return (
              <button key={v} onClick={() => { setView(v); setIsAdmin(false); }}
                id={v === "passport" ? "tutorial-passport-tab" : undefined}
                className="relative px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors"
                style={{
                  backgroundColor: view === v && !isAdmin ? "#1B90FF" : "transparent",
                  color: view === v && !isAdmin ? "#fff" : "#89D1FF",
                }}>
                {v === "passport" ? "My Passport" : v === "signup" ? "Profile" : "Dashboard"}
                {profileIncomplete && (
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full"
                    style={{ backgroundColor: "#DF1278", border: "1.5px solid #001642" }} />
                )}
              </button>
            );
          })}
        </div>
        )}
        <div className="flex items-center gap-2">
          {/* Feedback button — always visible when logged in */}
          {ssoUser && (
            <FeedbackButton />
          )}
          {/* User name in nav */}
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

        {/* Goodbye page — shown after account deletion */}
        {view === "goodbye" && (
          <GoodbyePage onContinue={() => setView("signup")} />
        )}

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
              name: currentUser.name, preferredName: currentUser.preferredName || "",
              role: currentUser.role,
              office: currentUser.office, country: currentUser.country,
              region: currentUser.region, interests: currentUser.interests,
            } : null}
            onComplete={async form => {
              if (backendAvailable) {
                try {
                  const saved = await API.upsertUser({
                    name: form.name, preferredName: form.preferredName || "",
                    role: form.role,
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
              // Show tutorial on first signup (not on profile edits)
              if (!hasSignedUp) {
                localStorage.removeItem("cp-tutorial-done");
                setShowTutorial(true);
              }
            }}
          />
        )}

        {view === "passport" && !isAdmin && (
          <PassportPage user={currentUser} />
        )}

        {/* Dashboard 2-panel grid */}
        {view === "dashboard" && !isAdmin && (
          <div className="flex-1 overflow-hidden flex flex-col">

            {/* User identity + progress strip */}
            {currentUser && (
              <div className="shrink-0 px-6 py-4 border-b flex items-center gap-6"
                style={{ backgroundColor: "#fff", borderColor: "#CFE6FA" }}>
                <div className="flex items-center gap-3">
                  <Avatar name={currentUser.name} email={currentUser.email} size={44} />
                  <div>
                    <div className="font-semibold text-sm" style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
                      {displayName(currentUser)}
                    </div>
                    <div className="text-xs" style={{ color: "#7C8896" }}>
                      {currentUser.role} · {currentUser.office}
                    </div>
                  </div>
                </div>
                <div className="h-8 w-px mx-2" style={{ backgroundColor: "#EAF5FF" }} />
                <div className="flex items-center gap-3">
                  {[
                    { label: "Chats completed", value: currentUser.chatsCompleted || 0, color: "#1B90FF" },
                    { label: "Regions collected", value: `${Object.keys(currentUser.collectedRegions || {}).length} / 4`, color: "#DF1278" },
                    { label: "Offices collected", value: Object.keys(currentUser.collectedOffices || {}).length, color: "#002060" },
                    { label: "Badges earned", value: (Array.isArray(currentUser.badges) ? currentUser.badges : []).length, color: "#7C3AED" },
                  ].map(s => (
                    <div key={s.label} className="flex flex-col items-center justify-center rounded-xl px-5 py-2.5"
                      style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF", minWidth: 90 }}>
                      <span className="text-xl font-semibold leading-none"
                        style={{ color: s.color, fontFamily: "'72Brand', sans-serif" }}>{s.value}</span>
                      <span className="text-[10px] mt-1 text-center leading-tight" style={{ color: "#7C8896" }}>{s.label}</span>
                    </div>
                  ))}
                </div>
                <div className="ml-auto">
                  <button onClick={() => setShowTutorial(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                    style={{ border: "1px solid #CFE6FA", color: "#1B90FF", backgroundColor: "#F5FAFF" }}>
                    <HelpCircle size={13} />
                    How it works
                  </button>
                </div>
              </div>
            )}

            {/* Two panels */}
            <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: "1fr 420px" }}>
              <div className="border-r overflow-hidden flex flex-col bg-white" style={{ borderColor: "#CFE6FA" }}>
                <div className="flex-shrink-0 overflow-hidden" style={{ minHeight: 0, flex: "0 1 auto", maxHeight: "calc(100% - 120px)" }}>
                  <MatchPanel
                    users={matcherUsers} matches={activeMatches} currentUser={currentUser}
                    onAccept={handleAccept} onReshuffle={handleReshuffle}
                    reshufflesLeft={reshufflesLeft} matchesLeft={matchesLeft}
                  />
                </div>

                {/* Recent Chats placeholder */}
                {(() => {
                  const completed = activeMatches.filter(m =>
                    (m.userAId === currentUser?.id || m.userBId === currentUser?.id) &&
                    m.status === "completed"
                  );
                  const usersById = Object.fromEntries(matcherUsers.map(u => [u.id, u]));
                  return (
                    <div className="shrink-0 border-t px-7 py-4" style={{ borderColor: "#EAF5FF" }}>
                      <div className="flex items-center gap-2 mb-3">
                        <Coffee size={13} color="#1B90FF" />
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                          style={{ color: "#002060", fontFamily: "'72Brand', sans-serif" }}>
                          Recent Chats
                        </span>
                        {completed.length > 0 && (
                          <span className="text-[10px] text-[#7C8896]">({completed.length})</span>
                        )}
                      </div>
                      {completed.length === 0 ? (
                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                          style={{ backgroundColor: "#F5FAFF", border: "1.5px dashed #CFE6FA" }}>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                            style={{ backgroundColor: "#EAF5FF" }}>
                            <Coffee size={14} color="#7C8896" />
                          </div>
                          <p className="text-xs" style={{ color: "#7C8896" }}>
                            Completed chats will appear here after both people confirm.
                          </p>
                        </div>
                      ) : (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {completed.slice(0, 5).map(m => {
                            const otherId = m.userAId === currentUser.id ? m.userBId : m.userAId;
                            const other = usersById[otherId];
                            if (!other) return null;
                            return (
                              <div key={m.id} className="shrink-0 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl"
                                style={{ backgroundColor: "#F5FAFF", border: "1px solid #EAF5FF", minWidth: 72 }}>
                                <Avatar name={other.name} email={other.email} size={32} />
                                <span className="text-[9px] font-medium text-center leading-tight"
                                  style={{ color: "#002060", maxWidth: 64 }}>
                                  {displayName(other).split(" ")[0]}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                                  style={{ backgroundColor: "#D1EFFF", color: "#002060" }}>
                                  {other.region}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div id="tutorial-matches-panel" className="overflow-hidden border-l" style={{ backgroundColor: "#fff", borderColor: "#CFE6FA" }}>
                <MatchesPanel matches={activeMatches} users={matcherUsers} currentUser={currentUser} onConfirm={handleConfirm} onRemove={handleRemove} onAcknowledge={handleAcknowledge} />
              </div>
            </div>

          </div>
        )}

        {isAdmin && (
          <div className="flex-1 overflow-hidden flex flex-col bg-white">
            {/* Admin sub-nav */}
            <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b" style={{ borderColor: "#CFE6FA", backgroundColor: "#F5FAFF" }}>
              {[
                { key: "dashboard", label: "Admin Dashboard" },
                { key: "demo",      label: "▶ Demo Mode" },
              ].map(tab => (
                <button key={tab.key} onClick={() => setAdminTab(tab.key)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: adminTab === tab.key ? "#002060" : "transparent",
                    color: adminTab === tab.key ? "#fff" : "#445063",
                  }}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden">
              {adminTab === "dashboard" && <AdminPanel users={matcherUsers} matches={activeMatches} />}
              {adminTab === "demo"      && <DemoMode onExit={() => setAdminTab("dashboard")} seedUsers={demoState.users} />}
            </div>
          </div>
        )}
      </div>

      {/* Tutorial overlay — shown on first login */}
      {showTutorial && (
        <TutorialOverlay onClose={() => setShowTutorial(false)} />
      )}
    </div>
  );
}
