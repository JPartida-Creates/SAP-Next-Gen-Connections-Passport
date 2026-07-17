"use strict";
const cds = require("@sap/cds");

const MAX_RESHUFFLES_PER_DAY = 3;
const MAX_MATCHES_PER_DAY = 3;
const MATCH_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

module.exports = cds.service.impl(async function (srv) {
  const { Users, Matches } = this.entities;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function callerEmail(req) {
    const email = req.user && req.user.id;
    if (!email) req.reject(401, "Unauthenticated");
    return email;
  }

  function todayStr() {
    return new Date().toDateString(); // matches React's todayStr()
  }

  function parseJSON(str, fallback) {
    if (!str) return fallback;
    if (typeof str !== "string") return str;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  // Mirror of recalcBadges from ConnectionsPassport.jsx
  function recalcBadges(user) {
    const regions = parseJSON(user.collectedRegions, {});
    const offices = parseJSON(user.collectedOffices, {});
    const regionCount = Object.keys(regions).length;
    const officeCount = Object.keys(offices).length;
    const chats = user.chatsCompleted || 0;
    const totalStamps =
      Object.values(regions).reduce((s, c) => s + c, 0) +
      Object.values(offices).reduce((s, c) => s + c, 0);
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

  // Award stamps to both users when a match is completed
  async function awardStampsToUsers(emailA, emailB) {
    const [userA, userB] = await Promise.all([
      SELECT.one.from(Users).where({ email: emailA }),
      SELECT.one.from(Users).where({ email: emailB }),
    ]);
    if (!userA || !userB) return;

    function applyStamp(user, other) {
      const regions = parseJSON(user.collectedRegions, {});
      const offices = parseJSON(user.collectedOffices, {});
      regions[other.region] = (regions[other.region] || 0) + 1;
      offices[other.office] = (offices[other.office] || 0) + 1;
      const chatsCompleted = (user.chatsCompleted || 0) + 1;
      const badges = recalcBadges({
        ...user,
        collectedRegions: regions,
        collectedOffices: offices,
        chatsCompleted,
      });
      return {
        collectedRegions: JSON.stringify(regions),
        collectedOffices: JSON.stringify(offices),
        chatsCompleted,
        badges: JSON.stringify(badges),
      };
    }

    await Promise.all([
      UPDATE(Users).set(applyStamp(userA, userB)).where({ email: emailA }),
      UPDATE(Users).set(applyStamp(userB, userA)).where({ email: emailB }),
    ]);
  }

  // ── getMyState ─────────────────────────────────────────────────────────────

  srv.on("getMyState", async (req) => {
    const email = callerEmail(req);

    const [user, matches, peers] = await Promise.all([
      SELECT.one.from(Users).where({ email }),
      SELECT.from(Matches).where(
        `userAEmail = '${email}' or userBEmail = '${email}'`
      ),
      SELECT.from(Users).where({ optedIn: true, paused: false, deleted: false })
        .and(`email != '${email}'`),
    ]);

    // Return as a JSON string (action returns String in CDS)
    return JSON.stringify({ user: user || null, matches, peers });
  });

  // ── upsertUser ─────────────────────────────────────────────────────────────

  srv.on("upsertUser", async (req) => {
    const email = callerEmail(req);
    const { profile } = req.data;
    const existing = await SELECT.one.from(Users).where({ email });

    if (existing) {
      await UPDATE(Users)
        .set({
          name: profile.name,
          role: profile.role,
          office: profile.office,
          country: profile.country,
          region: profile.region,
          interests: profile.interests,
          consentGiven: profile.consentGiven !== false,
        })
        .where({ email });
    } else {
      await INSERT.into(Users).entries({
        email,
        name: profile.name,
        role: profile.role,
        office: profile.office,
        country: profile.country,
        region: profile.region,
        interests: profile.interests,
        consentGiven: profile.consentGiven !== false,
        optedIn: true,
        paused: false,
        deleted: false,
        collectedRegions: "{}",
        collectedOffices: "{}",
        chatsCompleted: 0,
        badges: "[]",
        lastReshuffleDate: null,
        reshufflesUsedToday: 0,
        lastMatchAcceptDate: null,
        matchesAcceptedToday: 0,
        joinedAt: new Date().toISOString(),
      });
    }

    return SELECT.one.from(Users).where({ email });
  });

  // ── acceptMatch ────────────────────────────────────────────────────────────

  srv.on("acceptMatch", async (req) => {
    const email = callerEmail(req);
    const { otherEmail } = req.data;

    const me = await SELECT.one.from(Users).where({ email });
    if (!me) req.reject(404, "User not found — please sign up first");

    const isToday = me.lastMatchAcceptDate === todayStr();
    const usedToday = isToday ? (me.matchesAcceptedToday || 0) : 0;
    if (usedToday >= MAX_MATCHES_PER_DAY) {
      req.reject(429, "You've reached your 3-match daily limit. Come back tomorrow!");
    }

    const now = new Date();
    const expires = new Date(now.getTime() + MATCH_TTL_MS);
    const match = {
      id: cds.utils.uuid(),
      userAEmail: email,
      userBEmail: otherEmail,
      status: "active",
      confirmedA: false,
      confirmedB: false,
      acknowledgedByB: false,
      removed: false,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    await Promise.all([
      INSERT.into(Matches).entries(match),
      UPDATE(Users)
        .set({
          lastMatchAcceptDate: todayStr(),
          matchesAcceptedToday: usedToday + 1,
        })
        .where({ email }),
    ]);

    return match;
  });

  // ── confirmMatch ───────────────────────────────────────────────────────────

  srv.on("confirmMatch", async (req) => {
    const email = callerEmail(req);
    const { matchId } = req.data;

    const match = await SELECT.one.from(Matches).where({ id: matchId });
    if (!match) req.reject(404, "Match not found");

    const isUserA = match.userAEmail === email;
    const confirmedA = isUserA ? true : match.confirmedA;
    const confirmedB = isUserA ? match.confirmedB : true;
    const bothConfirmed = confirmedA && confirmedB;

    const updates = {
      confirmedA,
      confirmedB,
      status: bothConfirmed ? "completed" : "pending_confirmation",
    };

    await UPDATE(Matches).set(updates).where({ id: matchId });

    if (bothConfirmed) {
      await awardStampsToUsers(match.userAEmail, match.userBEmail);
    }

    return SELECT.one.from(Matches).where({ id: matchId });
  });

  // ── acknowledgeMatch ───────────────────────────────────────────────────────

  srv.on("acknowledgeMatch", async (req) => {
    const { matchId } = req.data;
    await UPDATE(Matches).set({ acknowledgedByB: true }).where({ id: matchId });
    return SELECT.one.from(Matches).where({ id: matchId });
  });

  // ── removeMatch ────────────────────────────────────────────────────────────

  srv.on("removeMatch", async (req) => {
    const { matchId } = req.data;
    await UPDATE(Matches).set({ removed: true, status: "expired" }).where({ id: matchId });
    return true;
  });

  // ── recordReshuffle ────────────────────────────────────────────────────────

  srv.on("recordReshuffle", async (req) => {
    const email = callerEmail(req);
    const me = await SELECT.one.from(Users).where({ email });
    if (!me) return true;

    const isToday = me.lastReshuffleDate === todayStr();
    await UPDATE(Users)
      .set({
        lastReshuffleDate: todayStr(),
        reshufflesUsedToday: isToday ? (me.reshufflesUsedToday || 0) + 1 : 1,
      })
      .where({ email });

    return true;
  });

  // ── pauseUser ──────────────────────────────────────────────────────────────

  srv.on("pauseUser", async (req) => {
    const email = callerEmail(req);
    const me = await SELECT.one.from(Users).where({ email });
    if (!me) req.reject(404, "User not found");

    await UPDATE(Users).set({ paused: !me.paused }).where({ email });
    return true;
  });

  // ── deleteUser ─────────────────────────────────────────────────────────────

  srv.on("deleteUser", async (req) => {
    const email = callerEmail(req);

    // Anonymize user account
    await UPDATE(Users)
      .set({ deleted: true, name: "SAP Next Gen Member", optedIn: false })
      .where({ email });

    // Expire all active/pending matches
    const activeMatches = await SELECT.from(Matches).where(
      `(userAEmail = '${email}' or userBEmail = '${email}')
       and status in ('active','pending_confirmation')`
    );
    for (const m of activeMatches) {
      await UPDATE(Matches).set({ status: "expired" }).where({ id: m.id });
    }

    return true;
  });
});
