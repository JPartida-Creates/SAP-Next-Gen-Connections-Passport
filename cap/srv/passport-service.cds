using connections.passport as db from '../db/schema';

service PassportService @(path:'/PassportService') {

  entity Users as projection on db.Users;

  entity Matches as projection on db.Matches;

  // ── Custom actions ────────────────────────────────────────────────────────

  action acceptMatch(otherEmail: String)   returns Matches;
  action confirmMatch(matchId: String)     returns Matches;
  action acknowledgeMatch(matchId: String) returns Matches;
  action removeMatch(matchId: String)      returns Boolean;
  action recordReshuffle()                 returns Boolean;
  action pauseUser()                       returns Boolean;
  action deleteUser()                      returns Boolean;
  action adminResetShuffles(email: String) returns Boolean;
  action adminSetActive(email: String)     returns Boolean;
  action adminGetAllUsers()                returns String;

  action upsertUser(profile: {
    name:          String;
    preferredName: String;
    role:          String;
    office:        String;
    country:       String;
    region:        String;
    interests:     String;
    consentGiven:  Boolean;
  }) returns Users;

  // Returns the caller's full state in one round-trip.
  // The response body is a JSON object with user, matches, peers.
  // Defined as an action (POST) so CAP routing works cleanly on BTP.
  action getMyState() returns String;
}
