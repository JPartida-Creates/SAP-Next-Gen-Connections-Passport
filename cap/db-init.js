"use strict";
const hdb = require("hdb");

// Read credentials from VCAP_SERVICES (user-provided service) or env vars
function getCredentials() {
  // Try VCAP_SERVICES first (Cloud Foundry binding)
  if (process.env.VCAP_SERVICES) {
    try {
      const vcap = JSON.parse(process.env.VCAP_SERVICES);
      const ups = vcap["user-provided"] || [];
      const svc = ups.find(s =>
        s.name === "connections-passport-db" ||
        (s.credentials && s.credentials.host && s.credentials.schema)
      );
      if (svc && svc.credentials) return svc.credentials;
    } catch (e) { /* fall through */ }
  }
  // Fall back to individual env vars
  return {
    host:     process.env.HANA_HOST,
    port:     parseInt(process.env.HANA_PORT || "443"),
    user:     process.env.HANA_USER,
    password: process.env.HANA_PASSWORD,
    schema:   process.env.HANA_SCHEMA,
  };
}

// Create tables in HANA if they don't already exist
async function ensureTables(creds) {
  const client = hdb.createClient({
    host:                creds.host,
    port:                parseInt(creds.port || 443),
    user:                creds.user,
    password:            creds.password,
    schema:              creds.schema,
    encrypt:             true,
    sslValidateCertificate: true,
  });

  await new Promise((resolve, reject) => {
    client.connect(err => err ? reject(err) : resolve());
  });

  const schema = creds.schema;

  const tables = [
    {
      name: "USERS",
      ddl: `CREATE COLUMN TABLE "${schema}"."USERS" (
        "EMAIL"               NVARCHAR(255) NOT NULL PRIMARY KEY,
        "NAME"                NVARCHAR(255),
        "ROLE"                NVARCHAR(100),
        "OFFICE"              NVARCHAR(100),
        "COUNTRY"             NVARCHAR(100),
        "REGION"              NVARCHAR(10),
        "INTERESTS"           NVARCHAR(2000),
        "OPTEDIN"             BOOLEAN DEFAULT TRUE,
        "PAUSED"              BOOLEAN DEFAULT FALSE,
        "DELETED"             BOOLEAN DEFAULT FALSE,
        "CONSENTGIVEN"        BOOLEAN DEFAULT FALSE,
        "COLLECTEDREGIONS"    NCLOB,
        "COLLECTEDOFFICES"    NCLOB,
        "CHATSCOMPLETED"      INTEGER DEFAULT 0,
        "BADGES"              NCLOB,
        "LASTRESHUFFLEDATE"   NVARCHAR(30),
        "RESHUFFLESUSEDTODAY" INTEGER DEFAULT 0,
        "LASTMATCHACCEPTDATE" NVARCHAR(30),
        "MATCHESACCEPTEDTODAY" INTEGER DEFAULT 0,
        "JOINEDAT"            TIMESTAMP
      )`,
    },
    {
      name: "MATCHES",
      ddl: `CREATE COLUMN TABLE "${schema}"."MATCHES" (
        "ID"              NVARCHAR(36) NOT NULL PRIMARY KEY,
        "USERAMAIL"       NVARCHAR(255),
        "USERBMAIL"       NVARCHAR(255),
        "STATUS"          NVARCHAR(30),
        "CONFIRMEDA"      BOOLEAN DEFAULT FALSE,
        "CONFIRMEDB"      BOOLEAN DEFAULT FALSE,
        "ACKNOWLEDGEDBYB" BOOLEAN DEFAULT FALSE,
        "REMOVED"         BOOLEAN DEFAULT FALSE,
        "CREATEDAT"       TIMESTAMP,
        "EXPIRESAT"       TIMESTAMP
      )`,
    },
  ];

  for (const table of tables) {
    // Check if table exists
    const exists = await new Promise((resolve, reject) => {
      client.exec(
        `SELECT COUNT(*) AS CNT FROM TABLES WHERE SCHEMA_NAME='${schema}' AND TABLE_NAME='${table.name}'`,
        (err, rows) => err ? reject(err) : resolve(rows[0].CNT > 0)
      );
    });

    if (!exists) {
      console.log(`Creating table ${schema}.${table.name}...`);
      await new Promise((resolve, reject) => {
        client.exec(table.ddl, err => err ? reject(err) : resolve());
      });
      console.log(`Table ${schema}.${table.name} created.`);
    } else {
      console.log(`Table ${schema}.${table.name} already exists.`);
    }
  }

  client.end();
}

module.exports = { getCredentials, ensureTables };
