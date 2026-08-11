# Twitch Notification Discord Bot

A Discord.js bot that sends a Twitch embed when a tracked streamer starts a **new Twitch broadcast**.

## Included commands

- `/notif setup [channel]` — choose the Discord text channel for notifications
- `/notif add [twitch]` — add a Twitch username or Twitch channel URL
- `/notif remove [twitch]` — remove a tracked Twitch channel
- `/notif list` — show all Twitch channels tracked in this Discord server

Only members with **Manage Server** can use `/notif`.

## What the bot stores

SQLite file: `notif.db`

Tables:

- `servers` — Discord server ID + notification channel ID
- `notifications` — Twitch user ID, username/display name, and `last_stream_id`

The bot stores Twitch's `stream.id` **after a notification successfully sends**. On every poll it compares the live stream ID against the saved ID. This means:

- the same live broadcast is not posted twice
- bot restarts do not cause duplicate notifications
- a future broadcast gets a new stream ID and sends normally
- if Discord fails to accept a notification, the stream ID is not saved, so the bot retries on the next poll

If someone is already live when you run `/notif add`, the current stream ID is saved without sending a notification. Their next broadcast will notify normally.

The bot polls Twitch every 60 seconds and batches up to 100 Twitch user IDs per Twitch API request.

---

# Browser-first setup: no coding on your computer

You do **not** need to write or edit the JavaScript locally. Everything is already in this folder.

You will need:

1. a Discord application/bot
2. a Twitch developer application
3. a GitHub repository
4. a Render account

Render deploys from a Git repository, so the only local step is getting these ready-made files into GitHub. The easiest browser-based route is:

1. Download this project ZIP.
2. Unzip it.
3. Create a blank GitHub repository.
4. In the GitHub repo, choose **Add file → Upload files**.
5. Drag the project files/folders into the upload area and commit them.
6. You do not need to install Node, npm, SQLite, or any coding tools on your computer.

Do **not** upload a real `.env` file or put your Discord/Twitch secrets in GitHub.

---

# 1. Create your Discord bot

Go to the Discord Developer Portal and create an application.

In the application:

## Bot

Create/enable the bot and copy its **bot token**.

You will use it on Render as:

`DISCORD_TOKEN`

Never put the token in GitHub.

## General Information

Copy the application's **Application ID**.

You will use it on Render as:

`DISCORD_CLIENT_ID`

## Installation / OAuth

Invite the bot to your Discord server with the scopes/permissions needed for a normal Discord bot plus application commands.

The bot needs access to the notification channel with at least:

- View Channel
- Send Messages
- Embed Links

The `/notif` command itself defaults to users with **Manage Server** permission.

You do not need Message Content intent for this bot.

---

# 2. Create your Twitch developer application

Create/register an application in the Twitch Developer Console.

Copy:

- Client ID → `TWITCH_CLIENT_ID`
- Client Secret → `TWITCH_CLIENT_SECRET`

This project automatically requests a Twitch **app access token** using the client-credentials flow. You do not manually create or paste a Twitch access token.

The Twitch app's redirect URL is not used by this bot's server-to-server flow, but Twitch's application registration form may require you to provide one. You can use a valid placeholder such as `http://localhost:3000`.

Never commit your Twitch Client Secret to GitHub.

---

# 3. Put the project on GitHub

Create a new repository. It can be private if your Render account is connected to a Git provider account that can access it.

Upload the **contents** of this project folder so the repository root looks like:

```text
your-repo/
├── src/
│   ├── commands.js
│   ├── database.js
│   ├── deploy-commands.js
│   ├── index.js
│   └── twitch.js
├── .env.example
├── .gitignore
├── .node-version
├── package.json
├── render.yaml
└── README.md
```

Do not upload the outer ZIP as the only file. Render needs the actual project files in the repository.

---

# 4. Deploy to Render with the included Blueprint

This repo includes `render.yaml`.

In Render:

1. Connect your GitHub account/repository.
2. Create a **Blueprint** from this repository.
3. Render reads `render.yaml`.
4. During initial Blueprint creation, Render should prompt you for the four secret environment variables:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
5. Enter the real values in Render.
6. Create/apply the Blueprint.

The Blueprint creates:

- one Node.js **background worker**
- a **1 GB persistent disk**
- disk mount path: `/var/data`
- `DATA_DIR=/var/data`
- Node.js 24.17.0
- build command: `npm install`
- start command: `npm start`

Your SQLite database will therefore live at:

```text
/var/data/notif.db
```

Only files under the disk mount path persist across Render restarts/redeploys, which is why the database is stored there.

## Important Render cost note

Render does not offer the free instance type for background workers, and persistent disks are attached to paid services. The included Blueprint therefore uses the `starter` worker plan plus a persistent disk.

Do not change this to a free web service expecting the exact same behavior: a Discord bot is a continuously running process, and SQLite must be on persistent storage if you want its data to survive deploys/restarts.

---

# 5. First startup

The bot automatically registers `/notif` with Discord every time it starts, so there is no separate `npm run deploy` step on Render.

In Render logs you should eventually see messages similar to:

```text
Registering /notif command with Discord...
Discord slash command registered.
✅ Logged in as YourBotName#0000
SQLite database: /var/data/notif.db
```

Global Discord application commands can take some time to propagate. If `/notif` is not visible immediately, give Discord a little time and make sure the bot was invited with application-command support.

---

# 6. Configure it in Discord

First:

```text
/notif setup channel:#stream-notifs
```

Then add streamers:

```text
/notif add twitch:infume
```

These also work:

```text
/notif add twitch:@infume
/notif add twitch:https://twitch.tv/infume
/notif add twitch:https://www.twitch.tv/infume
```

List them:

```text
/notif list
```

Remove one:

```text
/notif remove twitch:infume
```

Each Discord server that installs the bot gets its own notification channel and streamer list.

---

# Notification embed

A live notification contains:

- purple Twitch-style embed accent
- `STREAMER is now live on Twitch!`
- clickable Twitch stream title
- game
- current viewer count at detection time
- current Twitch stream thumbnail
- Twitch footer + timestamp

Example layout:

```text
┃ infume is now live on Twitch!
┃
┃ a little more
┃
┃ Game
┃ Minecraft
┃
┃ Viewers
┃ 896
┃
┃ [Twitch stream thumbnail]
┃
┃ Twitch • Today at 9:36 PM
```

The blue Discord embed title links directly to the streamer's Twitch page.

---

# Updating the bot later

Because the Blueprint uses automatic deploys, committing changes to the linked GitHub branch triggers another Render deploy.

The SQLite file stays on `/var/data`, so changing the code does not erase your configured Discord servers, tracked streamers, or remembered Twitch stream IDs.

---

# Troubleshooting

## `/notif` never appears

Check Render logs for:

```text
Discord slash command registered.
```

Also make sure:

- `DISCORD_CLIENT_ID` is your Discord application's Application ID
- `DISCORD_TOKEN` belongs to the same application
- the bot is actually installed in the server
- the app installation includes application commands

## Twitch username says it cannot be found

Make sure the Twitch Client ID/Secret are correct in Render. The bot validates Twitch usernames through Twitch's users endpoint before storing them.

## No notification arrives

Run `/notif list` and verify the destination channel.

Make sure the bot has:

- View Channel
- Send Messages
- Embed Links

Then check Render logs.

## Bot restarted but did not repost the current stream

That is intentional. SQLite remembers the exact Twitch `stream.id` already posted.

## I added a streamer while they were live but no notification appeared

Also intentional. The bot records the already-running stream when the streamer is added, so it does not send a late notification for a broadcast that started before you began tracking them.

## Where is my database?

On Render:

```text
/var/data/notif.db
```

Locally, if you ever run it yourself with no `DATA_DIR`:

```text
./data/notif.db
```
