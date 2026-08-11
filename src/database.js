import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR || "./data";

fs.mkdirSync(dataDir, {
  recursive: true,
});

const dbPath = path.join(
  dataDir,
  "notif.db"
);

const db = new DatabaseSync(dbPath, {
  enableForeignKeyConstraints: true,
  timeout: 5000,
});

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS servers (
    guild_id TEXT PRIMARY KEY,
    notification_channel_id TEXT
  );

  CREATE TABLE IF NOT EXISTS notifications (
    guild_id TEXT NOT NULL,
    twitch_user_id TEXT NOT NULL,
    twitch_username TEXT NOT NULL,
    twitch_display_name TEXT NOT NULL,
    last_stream_id TEXT,

    PRIMARY KEY (
      guild_id,
      twitch_user_id
    ),

    FOREIGN KEY (guild_id)
      REFERENCES servers(guild_id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS
    idx_notifications_twitch_user_id
  ON notifications(twitch_user_id);

  CREATE INDEX IF NOT EXISTS
    idx_notifications_guild_username
  ON notifications(
    guild_id,
    twitch_username
  );
`);


// ========================================
// PREPARED STATEMENTS
// ========================================

const ensureServerStmt =
  db.prepare(`
    INSERT INTO servers (
      guild_id
    )
    VALUES (?)
    ON CONFLICT(guild_id)
    DO NOTHING
  `);


const setChannelStmt =
  db.prepare(`
    UPDATE servers
    SET notification_channel_id = ?
    WHERE guild_id = ?
  `);


const getServerStmt =
  db.prepare(`
    SELECT
      guild_id,
      notification_channel_id
    FROM servers
    WHERE guild_id = ?
  `);


const addStreamerStmt =
  db.prepare(`
    INSERT INTO notifications (
      guild_id,
      twitch_user_id,
      twitch_username,
      twitch_display_name,
      last_stream_id
    )
    VALUES (?, ?, ?, ?, NULL)
  `);


const getStreamerByUsernameStmt =
  db.prepare(`
    SELECT *
    FROM notifications
    WHERE guild_id = ?
      AND LOWER(twitch_username)
        = LOWER(?)
  `);


const getStreamerByUserIdStmt =
  db.prepare(`
    SELECT *
    FROM notifications
    WHERE guild_id = ?
      AND twitch_user_id = ?
  `);


const removeStreamerStmt =
  db.prepare(`
    DELETE FROM notifications
    WHERE guild_id = ?
      AND twitch_user_id = ?
  `);


const getGuildStreamersStmt =
  db.prepare(`
    SELECT *
    FROM notifications
    WHERE guild_id = ?
    ORDER BY
      twitch_display_name
      COLLATE NOCASE
  `);


const getAllNotificationsStmt =
  db.prepare(`
    SELECT
      n.guild_id,
      n.twitch_user_id,
      n.twitch_username,
      n.twitch_display_name,
      n.last_stream_id,
      s.notification_channel_id
    FROM notifications AS n
    JOIN servers AS s
      ON s.guild_id = n.guild_id
    WHERE
      s.notification_channel_id
      IS NOT NULL
  `);


const setLastStreamIdStmt =
  db.prepare(`
    UPDATE notifications
    SET last_stream_id = ?
    WHERE guild_id = ?
      AND twitch_user_id = ?
  `);


const updateTwitchIdentityStmt =
  db.prepare(`
    UPDATE notifications
    SET
      twitch_username = ?,
      twitch_display_name = ?
    WHERE twitch_user_id = ?
  `);


// ========================================
// EXPORTED FUNCTIONS
// ========================================

export function ensureServer(
  guildId
) {
  ensureServerStmt.run(
    guildId
  );
}


export function setNotificationChannel(
  guildId,
  channelId
) {
  ensureServer(guildId);

  setChannelStmt.run(
    channelId,
    guildId
  );
}


export function getServer(
  guildId
) {
  return getServerStmt.get(
    guildId
  );
}


export function addStreamer(
  guildId,
  twitchUser
) {
  ensureServer(guildId);

  return addStreamerStmt.run(
    guildId,
    twitchUser.id,
    twitchUser.login.toLowerCase(),
    twitchUser.display_name
  );
}


export function getStreamerByUsername(
  guildId,
  twitchUsername
) {
  return getStreamerByUsernameStmt.get(
    guildId,
    twitchUsername
  );
}


export function getStreamerByUserId(
  guildId,
  twitchUserId
) {
  return getStreamerByUserIdStmt.get(
    guildId,
    twitchUserId
  );
}


export function removeStreamer(
  guildId,
  twitchUserId
) {
  return removeStreamerStmt.run(
    guildId,
    twitchUserId
  );
}


export function getGuildStreamers(
  guildId
) {
  return getGuildStreamersStmt.all(
    guildId
  );
}


export function getAllNotifications() {
  return getAllNotificationsStmt.all();
}


export function setLastStreamId(
  guildId,
  twitchUserId,
  streamId
) {
  setLastStreamIdStmt.run(
    streamId,
    guildId,
    twitchUserId
  );
}


export function updateTwitchIdentity(
  twitchUserId,
  username,
  displayName
) {
  updateTwitchIdentityStmt.run(
    username.toLowerCase(),
    displayName,
    twitchUserId
  );
}


export function getDatabasePath() {
  return dbPath;
}


export default db;
