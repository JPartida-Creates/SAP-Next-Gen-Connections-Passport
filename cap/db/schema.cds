namespace connections.passport;

entity Users {
  key email            : String(255);
  name                 : String(255);
  role                 : String(100);
  office               : String(100);
  country              : String(100);
  region               : String(10);        // EMEA | APAC | NA | MEE
  interests            : String(2000);      // comma-separated list
  optedIn              : Boolean default true;
  paused               : Boolean default false;
  deleted              : Boolean default false;
  consentGiven         : Boolean default false;
  collectedRegions     : LargeString;       // JSON object: {"EMEA":2,"APAC":1}
  collectedOffices     : LargeString;       // JSON object: {"Berlin":1,"Tokyo":2}
  chatsCompleted       : Integer default 0;
  badges               : LargeString;       // JSON array of badge name strings
  lastReshuffleDate    : String(30);        // matches JS Date.toDateString() format
  reshufflesUsedToday  : Integer default 0;
  lastMatchAcceptDate  : String(30);
  matchesAcceptedToday : Integer default 0;
  joinedAt             : Timestamp;
}

entity Matches {
  key id              : UUID;
  userAEmail          : String(255);
  userBEmail          : String(255);
  status              : String(30);   // active | pending_confirmation | completed | expired
  confirmedA          : Boolean default false;
  confirmedB          : Boolean default false;
  acknowledgedByB     : Boolean default false;
  removed             : Boolean default false;
  createdAt           : Timestamp;
  expiresAt           : Timestamp;
}
