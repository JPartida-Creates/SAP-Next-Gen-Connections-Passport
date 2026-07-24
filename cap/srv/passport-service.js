"use strict";
const cds  = require("@sap/cds");
const hdb  = require("hdb");
const { getCredentials, ensureTables } = require("../db-init");

const MAX_RESHUFFLES_PER_DAY = 3;
const MAX_MATCHES_PER_DAY    = 3;
const MATCH_TTL_MS           = 7 * 24 * 3600 * 1000;

// ── DB connection pool (single persistent connection) ──────────────────────
let _client = null;

async function getClient() {
  if (_client && _client.readyState === "connected") return _client;
  const creds = getCredentials();
  _client = hdb.createClient({
    host:                   creds.host,
    port:                   parseInt(creds.port || 443),
    user:                   creds.user,
    password:               creds.password,
    schema:                 creds.schema,
    encrypt:                true,
    sslValidateCertificate: true,
  });
  await new Promise((resolve, reject) => {
    _client.connect(err => err ? reject(err) : resolve());
  });
  return _client;
}

function exec(sql, params = []) {
  return new Promise(async (resolve, reject) => {
    const client = await getClient().catch(reject);
    if (!client) return;
    // If no params, use simple exec; otherwise use prepared statement
    if (params.length === 0) {
      client.exec(sql, (err, rows) => err ? reject(err) : resolve(rows));
    } else {
      client.prepare(sql, (err, stmt) => {
        if (err) return reject(err);
        stmt.exec(params, (err2, rows) => err2 ? reject(err2) : resolve(rows));
      });
    }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function callerEmail(req) {
  const u = req.user;
  const email = u && (u.id || u.attr?.email || u.attr?.mail);
  console.log("callerEmail:", email, "| id:", u?.id, "| attr:", JSON.stringify(u?.attr));
  if (!email) { req.reject(401, "Unauthenticated"); return null; }
  return email;
}

function todayStr() { return new Date().toDateString(); }

function parseJSON(str, fallback) {
  if (!str) return fallback;
  if (typeof str !== "string") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function rowToUser(r) {
  if (!r) return null;
  function bufStr(v, fallback) {
    if (!v) return fallback;
    if (Buffer.isBuffer(v)) return v.toString("utf8");
    return v;
  }
  return {
    email:                r.EMAIL,
    name:                 r.NAME,
    preferredName:        r.PREFERREDNAME || "",
    role:                 r.ROLE,
    office:               r.OFFICE,
    country:              r.COUNTRY,
    region:               r.REGION,
    interests:            r.INTERESTS,
    optedIn:              r.OPTEDIN,
    paused:               r.PAUSED,
    deleted:              r.DELETED,
    consentGiven:         r.CONSENTGIVEN,
    collectedRegions:     bufStr(r.COLLECTEDREGIONS, "{}"),
    collectedOffices:     bufStr(r.COLLECTEDOFFICES, "{}"),
    chatsCompleted:       r.CHATSCOMPLETED || 0,
    badges:               bufStr(r.BADGES, "[]"),
    lastReshuffleDate:    r.LASTRESHUFFLEDATE,
    reshufflesUsedToday:  r.RESHUFFLESUSEDTODAY || 0,
    lastMatchAcceptDate:  r.LASTMATCHACCEPTDATE,
    matchesAcceptedToday: r.MATCHESACCEPTEDTODAY || 0,
    joinedAt:             r.JOINEDAT,
  };
}

function rowToMatch(r) {
  if (!r) return null;
  return {
    id:              r.ID,
    userAEmail:      r.USERAMAIL,
    userBEmail:      r.USERBMAIL,
    status:          r.STATUS,
    confirmedA:      r.CONFIRMEDA,
    confirmedB:      r.CONFIRMEDB,
    acknowledgedByB: r.ACKNOWLEDGEDBYB,
    removed:         r.REMOVED,
    createdAt:       r.CREATEDAT,
    expiresAt:       r.EXPIRESAT,
  };
}

// Mirror of recalcBadges from ConnectionsPassport.jsx
function recalcBadges(user) {
  const regions = parseJSON(user.collectedRegions, {});
  const offices = parseJSON(user.collectedOffices, {});
  const regionCount = Object.keys(regions).length;
  const officeCount = Object.keys(offices).length;
  const chats = user.chatsCompleted || 0;
  const totalStamps = Object.values(regions).reduce((s,c)=>s+c,0)
                    + Object.values(offices).reduce((s,c)=>s+c,0);
  const badges = [];
  if (chats >= 1)  badges.push("First Connection");
  if (chats >= 5)  badges.push("5 Chats Completed");
  if (chats >= 10) badges.push("10 Chats Completed");
  if (chats >= 20) badges.push("20 Chats Completed");
  if (regions["EMEA"]) badges.push("EMEA Explorer");
  if (regions["APAC"]) badges.push("APAC Explorer");
  if (regions["NA"])   badges.push("NA Explorer");
  if (regions["MEE"])  badges.push("MEE Explorer");
  if (regionCount >= 3) badges.push("3 Regions Collected");
  if (regionCount >= 4) badges.push("Global Explorer");
  if (officeCount >= 5)  badges.push("5 Offices Collected");
  if (officeCount >= 10) badges.push("Office Hopper");
  if (officeCount >= 14) badges.push("Stamp Collector");
  if (totalStamps >= 10) badges.push("Passport Pro");
  return badges;
}

async function awardStampsToUsers(emailA, emailB) {
  const creds = getCredentials();
  const schema = creds.schema;
  const rows = await exec(
    `SELECT * FROM "${schema}"."USERS" WHERE "EMAIL" IN (?,?)`, [emailA, emailB]
  );
  const userA = rowToUser(rows.find(r => r.EMAIL === emailA));
  const userB = rowToUser(rows.find(r => r.EMAIL === emailB));
  if (!userA || !userB) return;

  function applyStamp(user, other) {
    const regions = parseJSON(user.collectedRegions, {});
    const offices = parseJSON(user.collectedOffices, {});
    regions[other.region] = (regions[other.region] || 0) + 1;
    offices[other.office] = (offices[other.office] || 0) + 1;
    const chatsCompleted = (user.chatsCompleted || 0) + 1;
    const badges = recalcBadges({ ...user, collectedRegions: regions, collectedOffices: offices, chatsCompleted });
    return { regions: JSON.stringify(regions), offices: JSON.stringify(offices), chats: chatsCompleted, badges: JSON.stringify(badges) };
  }

  const sA = applyStamp(userA, userB);
  const sB = applyStamp(userB, userA);

  await exec(`UPDATE "${schema}"."USERS" SET "COLLECTEDREGIONS"=?,"COLLECTEDOFFICES"=?,"CHATSCOMPLETED"=?,"BADGES"=? WHERE "EMAIL"=?`,
    [sA.regions, sA.offices, sA.chats, sA.badges, emailA]);
  await exec(`UPDATE "${schema}"."USERS" SET "COLLECTEDREGIONS"=?,"COLLECTEDOFFICES"=?,"CHATSCOMPLETED"=?,"BADGES"=? WHERE "EMAIL"=?`,
    [sB.regions, sB.offices, sB.chats, sB.badges, emailB]);
}

// ── CAP service ────────────────────────────────────────────────────────────

module.exports = cds.service.impl(async function (srv) {
  const schema = getCredentials().schema || "ConnectionsPassport";

  // Ensure tables exist on startup
  cds.on("served", async () => {
    try {
      await ensureTables(getCredentials());
      console.log("HANA tables ready.");
    } catch (e) {
      console.error("Failed to ensure HANA tables:", e.message);
    }
  });

  // ── getMyState ───────────────────────────────────────────────────────────
  srv.on("getMyState", async (req) => {
    const email = callerEmail(req);
    if (!email) return;
    const userRows  = await exec(`SELECT * FROM "${schema}"."USERS" WHERE "EMAIL"=?`, [email]);
    console.log("userRows ok, count:", userRows.length);
    const matchRows = await exec(`SELECT * FROM "${schema}"."MATCHES" WHERE "USERAMAIL"=? OR "USERBMAIL"=?`, [email, email]);
    console.log("matchRows ok, count:", matchRows.length);
    const peerRows  = await exec(`SELECT * FROM "${schema}"."USERS" WHERE "OPTEDIN"=TRUE AND "PAUSED"=FALSE AND "DELETED"=FALSE AND "EMAIL"!=?`, [email]);
    console.log("peerRows ok, count:", peerRows.length);
    return JSON.stringify({
      user:    userRows.length ? rowToUser(userRows[0]) : null,
      matches: matchRows.map(rowToMatch),
      peers:   peerRows.map(rowToUser),
    });
  });

  // ── upsertUser ───────────────────────────────────────────────────────────
  srv.on("upsertUser", async (req) => {
    const email = callerEmail(req);
    if (!email) return;
    const { profile } = req.data;
    const existing = await exec(`SELECT "EMAIL" FROM "${schema}"."USERS" WHERE "EMAIL"=?`, [email]);

    if (existing.length > 0) {
      await exec(
        `UPDATE "${schema}"."USERS" SET "NAME"=?,"PREFERREDNAME"=?,"ROLE"=?,"OFFICE"=?,"COUNTRY"=?,"REGION"=?,"INTERESTS"=?,"CONSENTGIVEN"=?,"DELETED"=FALSE,"OPTEDIN"=TRUE,"PAUSED"=FALSE WHERE "EMAIL"=?`,
        [profile.name, profile.preferredName || "", profile.role, profile.office, profile.country, profile.region, profile.interests, profile.consentGiven !== false, email]
      );
    } else {
      await exec(
        `INSERT INTO "${schema}"."USERS" ("EMAIL","NAME","PREFERREDNAME","ROLE","OFFICE","COUNTRY","REGION","INTERESTS","CONSENTGIVEN","OPTEDIN","PAUSED","DELETED","COLLECTEDREGIONS","COLLECTEDOFFICES","CHATSCOMPLETED","BADGES","RESHUFFLESUSEDTODAY","MATCHESACCEPTEDTODAY","JOINEDAT")
         VALUES (?,?,?,?,?,?,?,?,TRUE,TRUE,FALSE,FALSE,'{}','{}',0,'[]',0,0,CURRENT_TIMESTAMP)`,
        [email, profile.name, profile.preferredName || "", profile.role, profile.office, profile.country, profile.region, profile.interests]
      );
    }
    const rows = await exec(`SELECT * FROM "${schema}"."USERS" WHERE "EMAIL"=?`, [email]);
    return rowToUser(rows[0]);
  });

  // ── acceptMatch ──────────────────────────────────────────────────────────
  srv.on("acceptMatch", async (req) => {
    const email = callerEmail(req);
    if (!email) return;
    const { otherEmail } = req.data;
    const rows = await exec(`SELECT * FROM "${schema}"."USERS" WHERE "EMAIL"=?`, [email]);
    if (!rows.length) req.reject(404, "User not found — please sign up first");
    const me = rowToUser(rows[0]);

    const isToday  = me.lastMatchAcceptDate === todayStr();
    const usedToday = isToday ? (me.matchesAcceptedToday || 0) : 0;
    if (usedToday >= MAX_MATCHES_PER_DAY) req.reject(429, "You've reached your 3-match daily limit. Come back tomorrow!");

    const id      = cds.utils.uuid();
    const now     = new Date();
    const expires = new Date(now.getTime() + MATCH_TTL_MS);
    // hdb requires ISO string for TIMESTAMP columns, not JS Date objects
    const nowISO     = now.toISOString().replace("T", " ").replace("Z", "");
    const expiresISO = expires.toISOString().replace("T", " ").replace("Z", "");

    await exec(
      `INSERT INTO "${schema}"."MATCHES" ("ID","USERAMAIL","USERBMAIL","STATUS","CONFIRMEDA","CONFIRMEDB","ACKNOWLEDGEDBYB","REMOVED","CREATEDAT","EXPIRESAT")
       VALUES (?,?,?,'active',FALSE,FALSE,FALSE,FALSE,?,?)`,
      [id, email, otherEmail, nowISO, expiresISO]
    );
    await exec(
      `UPDATE "${schema}"."USERS" SET "LASTMATCHACCEPTDATE"=?,"MATCHESACCEPTEDTODAY"=? WHERE "EMAIL"=?`,
      [todayStr(), usedToday + 1, email]
    );

    const mRows = await exec(`SELECT * FROM "${schema}"."MATCHES" WHERE "ID"=?`, [id]);
    return rowToMatch(mRows[0]);
  });

  // ── confirmMatch ─────────────────────────────────────────────────────────
  srv.on("confirmMatch", async (req) => {
    const email = callerEmail(req);
    if (!email) return;
    const { matchId } = req.data;
    const rows = await exec(`SELECT * FROM "${schema}"."MATCHES" WHERE "ID"=?`, [matchId]);
    if (!rows.length) req.reject(404, "Match not found");
    const match = rowToMatch(rows[0]);

    const isUserA    = match.userAEmail === email;
    const confirmedA = isUserA ? true : match.confirmedA;
    const confirmedB = isUserA ? match.confirmedB : true;
    const both       = confirmedA && confirmedB;
    const status     = both ? "completed" : "pending_confirmation";

    await exec(
      `UPDATE "${schema}"."MATCHES" SET "CONFIRMEDA"=?,"CONFIRMEDB"=?,"STATUS"=? WHERE "ID"=?`,
      [confirmedA, confirmedB, status, matchId]
    );
    if (both) await awardStampsToUsers(match.userAEmail, match.userBEmail);

    const updated = await exec(`SELECT * FROM "${schema}"."MATCHES" WHERE "ID"=?`, [matchId]);
    return rowToMatch(updated[0]);
  });

  // ── acknowledgeMatch ─────────────────────────────────────────────────────
  srv.on("acknowledgeMatch", async (req) => {
    const { matchId } = req.data;
    await exec(`UPDATE "${schema}"."MATCHES" SET "ACKNOWLEDGEDBYB"=TRUE WHERE "ID"=?`, [matchId]);
    const rows = await exec(`SELECT * FROM "${schema}"."MATCHES" WHERE "ID"=?`, [matchId]);
    return rowToMatch(rows[0]);
  });

  // ── removeMatch ──────────────────────────────────────────────────────────
  srv.on("removeMatch", async (req) => {
    const { matchId } = req.data;
    await exec(`UPDATE "${schema}"."MATCHES" SET "REMOVED"=TRUE,"STATUS"='expired' WHERE "ID"=?`, [matchId]);
    return true;
  });

  // ── recordReshuffle ──────────────────────────────────────────────────────
  srv.on("recordReshuffle", async (req) => {
    const email = callerEmail(req);
    if (!email) return true;
    const rows  = await exec(`SELECT * FROM "${schema}"."USERS" WHERE "EMAIL"=?`, [email]);
    if (!rows.length) return true;
    const me     = rowToUser(rows[0]);
    const isToday = me.lastReshuffleDate === todayStr();
    await exec(
      `UPDATE "${schema}"."USERS" SET "LASTRESHUFFLEDATE"=?,"RESHUFFLESUSEDTODAY"=? WHERE "EMAIL"=?`,
      [todayStr(), isToday ? (me.reshufflesUsedToday || 0) + 1 : 1, email]
    );
    return true;
  });

  // ── pauseUser ────────────────────────────────────────────────────────────
  srv.on("pauseUser", async (req) => {
    const email = callerEmail(req);
    if (!email) return;
    const rows  = await exec(`SELECT "PAUSED" FROM "${schema}"."USERS" WHERE "EMAIL"=?`, [email]);
    if (!rows.length) req.reject(404, "User not found");
    await exec(`UPDATE "${schema}"."USERS" SET "PAUSED"=? WHERE "EMAIL"=?`, [!rows[0].PAUSED, email]);
    return true;
  });

  // ── deleteUser ───────────────────────────────────────────────────────────
  srv.on("deleteUser", async (req) => {
    const email = callerEmail(req);
    if (!email) return;
    await exec(
      `UPDATE "${schema}"."USERS" SET "DELETED"=TRUE,"NAME"='SAP Next Gen Member',"OPTEDIN"=FALSE,"COLLECTEDREGIONS"='{}', "COLLECTEDOFFICES"='{}', "CHATSCOMPLETED"=0,"BADGES"='[]',"RESHUFFLESUSEDTODAY"=0,"MATCHESACCEPTEDTODAY"=0 WHERE "EMAIL"=?`,
      [email]
    );
    await exec(
      `UPDATE "${schema}"."MATCHES" SET "STATUS"='expired' WHERE ("USERAMAIL"=? OR "USERBMAIL"=?) AND "STATUS" IN ('active','pending_confirmation')`,
      [email, email]
    );
    return true;
  });

  // ── adminGetAllUsers ─────────────────────────────────────────────────────
  srv.on("adminGetAllUsers", async (req) => {
    const caller = callerEmail(req);
    if (!caller) return;
    if (caller !== "j.partida@sap.com") req.reject(403, "Admin only");
    const rows = await exec(`SELECT * FROM "${schema}"."USERS"`, []);
    return JSON.stringify(rows.map(rowToUser));
  });

  // ── adminSetActive ───────────────────────────────────────────────────────
  srv.on("adminSetActive", async (req) => {
    const caller = callerEmail(req);
    if (!caller) return;
    if (caller !== "j.partida@sap.com") req.reject(403, "Admin only");
    const { email } = req.data;
    if (!email) req.reject(400, "email required");
    await exec(
      `UPDATE "${schema}"."USERS" SET "OPTEDIN"=TRUE,"PAUSED"=FALSE,"DELETED"=FALSE WHERE "EMAIL"=?`,
      [email]
    );
    return true;
  });

  // ── adminResetShuffles ───────────────────────────────────────────────────
  srv.on("adminResetShuffles", async (req) => {
    const caller = callerEmail(req);
    if (!caller) return;
    if (caller !== "j.partida@sap.com") req.reject(403, "Admin only");
    const { email } = req.data;
    if (!email) req.reject(400, "email required");
    await exec(
      `UPDATE "${schema}"."USERS" SET "RESHUFFLESUSEDTODAY"=0,"LASTRESHUFFLEDATE"=NULL WHERE "EMAIL"=?`,
      [email]
    );
    return true;
  });
});
