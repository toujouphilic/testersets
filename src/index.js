import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

import {
  addStreamer,
  getAllNotifications,
  getDatabasePath,
  getGuildStreamers,
  getServer,
  getStreamerByUserId,
  getStreamerByUsername,
  removeStreamer,
  setLastStreamId,
  setNotificationChannel,
  updateTwitchIdentity,
} from "./database.js";

import { deployCommands } from "./deploy-commands.js";
import {
  getStream,
  getStreams,
  getTwitchUser,
} from "./twitch.js";

const requiredEnv = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnv.join(", ")}`,
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const POLL_INTERVAL_MS = 60_000;
let streamCheckRunning = false;

function cleanTwitchUsername(input) {
  return input
    .trim()
    .replace(/^https?:\/\/(?:www\.)?twitch\.tv\//i, "")
    .replace(/^twitch\.tv\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "")
    .toLowerCase();
}

function createTwitchEmbed(stream) {
  const username = stream.user_login;
  const twitchUrl = `https://www.twitch.tv/${username}`;

  let thumbnail = stream.thumbnail_url
    .replace("{width}", "1280")
    .replace("{height}", "720");

  // Bust Discord's image cache so each notification uses the current preview.
  thumbnail += `?t=${Date.now()}`;

  return new EmbedBuilder()
    .setColor(0x9146ff)
    .setAuthor({
      name: `${stream.user_name} is now live on Twitch!`,
    })
    .setTitle(stream.title || "Live on Twitch")
    .setURL(twitchUrl)
    .addFields(
      {
        name: "Game",
        value: stream.game_name || "Unknown",
        inline: false,
      },
      {
        name: "Viewers",
        value: Number(stream.viewer_count).toLocaleString(),
        inline: false,
      },
    )
    .setImage(thumbnail)
    .setFooter({ text: "Twitch" })
    .setTimestamp();
}

async function sendLiveNotification(notification, stream) {
  try {
    const channel = await client.channels.fetch(
      notification.notification_channel_id,
    );

    if (!channel || !channel.isTextBased() || !("guild" in channel)) {
      console.error(
        `Channel ${notification.notification_channel_id} is not a usable guild text channel.`,
      );
      return false;
    }

    const me = channel.guild.members.me;

    if (me) {
      const permissions = channel.permissionsFor(me);

      const canSend = permissions?.has(
        PermissionFlagsBits.SendMessages,
      );
      const canEmbed = permissions?.has(
        PermissionFlagsBits.EmbedLinks,
      );

      if (!canSend || !canEmbed) {
        console.error(
          `Missing Send Messages or Embed Links in ${channel.guild.name} / #${channel.name}.`,
        );
        return false;
      }
    }

    await channel.send({
      embeds: [createTwitchEmbed(stream)],
    });

    console.log(
      `🔴 Sent notification for ${stream.user_name} in ${channel.guild.name}.`,
    );

    return true;
  } catch (error) {
    console.error(
      `Could not send notification for ${stream.user_name}:`,
      error,
    );
    return false;
  }
}

async function checkStreams() {
  if (streamCheckRunning) {
    return;
  }

  streamCheckRunning = true;

  try {
    const notifications = getAllNotifications();

    if (notifications.length === 0) {
      return;
    }

    const uniqueUserIds = [
      ...new Set(
        notifications.map((row) => row.twitch_user_id),
      ),
    ];

    const liveStreams = await getStreams(uniqueUserIds);

    const liveByUserId = new Map(
      liveStreams.map((stream) => [stream.user_id, stream]),
    );

    for (const notification of notifications) {
      const stream = liveByUserId.get(
        notification.twitch_user_id,
      );

      if (!stream) {
        continue;
      }

      // Keep stored Twitch names current if the account was renamed.
      if (
        notification.twitch_username !== stream.user_login.toLowerCase() ||
        notification.twitch_display_name !== stream.user_name
      ) {
        updateTwitchIdentity(
          stream.user_id,
          stream.user_login,
          stream.user_name,
        );
      }

      // Same broadcast we already notified for.
      if (notification.last_stream_id === stream.id) {
        continue;
      }

      console.log(
        `New Twitch stream detected: ${stream.user_name} (${stream.id})`,
      );

      const sent = await sendLiveNotification(
        notification,
        stream,
      );

      // Store the stream ID only after Discord successfully accepts the embed.
      if (sent) {
        setLastStreamId(
          notification.guild_id,
          notification.twitch_user_id,
          stream.id,
        );
      }
    }
  } catch (error) {
    console.error("Twitch polling failed:", error);
  } finally {
    streamCheckRunning = false;
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName !== "notif" || !interaction.guildId) {
    return;
  }

  const guildId = interaction.guildId;
  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === "setup") {
      const channel = interaction.options.getChannel(
        "channel",
        true,
      );

      const botMember = interaction.guild?.members.me;

      if (botMember) {
        const permissions = channel.permissionsFor(botMember);

        if (
          !permissions?.has(PermissionFlagsBits.SendMessages)
        ) {
          await interaction.reply({
            content:
              `❌ I can't send messages in ${channel}. Give me **Send Messages** permission there first.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (!permissions?.has(PermissionFlagsBits.EmbedLinks)) {
          await interaction.reply({
            content:
              `❌ I don't have **Embed Links** permission in ${channel}.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      setNotificationChannel(guildId, channel.id);

      await interaction.reply({
        content:
          `✅ Twitch notifications will now be sent in ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "add") {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      });

      const input = interaction.options.getString(
        "twitch",
        true,
      );
      const username = cleanTwitchUsername(input);

      if (!username) {
        await interaction.editReply({
          content:
            "❌ Please give me a Twitch username or Twitch channel URL.",
        });
        return;
      }

      const server = getServer(guildId);

      if (!server?.notification_channel_id) {
        await interaction.editReply({
          content:
            "❌ Run `/notif setup` first so I know where to send notifications.",
        });
        return;
      }

      const twitchUser = await getTwitchUser(username);

      if (!twitchUser) {
        await interaction.editReply({
          content:
            `❌ I couldn't find a Twitch channel named **${username}**.`,
        });
        return;
      }

      const existingById = getStreamerByUserId(
        guildId,
        twitchUser.id,
      );

      if (existingById) {
        await interaction.editReply({
          content:
            `⚠️ **${twitchUser.display_name}** is already being tracked.`,
        });
        return;
      }

      addStreamer(guildId, twitchUser);

      // If this person is already live when added, remember that stream without
      // notifying. Their next new stream will generate a notification.
      const currentStream = await getStream(twitchUser.login);

      if (currentStream) {
        setLastStreamId(
          guildId,
          twitchUser.id,
          currentStream.id,
        );
      }

      await interaction.editReply({
        content:
          `✅ Added **${twitchUser.display_name}** to Twitch notifications.`,
      });
      return;
    }

    if (subcommand === "remove") {
      const input = interaction.options.getString(
        "twitch",
        true,
      );
      const username = cleanTwitchUsername(input);

      const existing = getStreamerByUsername(
        guildId,
        username,
      );

      if (!existing) {
        await interaction.reply({
          content:
            `❌ **${username}** isn't currently being tracked.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      removeStreamer(
        guildId,
        existing.twitch_user_id,
      );

      await interaction.reply({
        content:
          `✅ Removed **${existing.twitch_display_name}** from Twitch notifications.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "list") {
      const streamers = getGuildStreamers(guildId);

      if (streamers.length === 0) {
        await interaction.reply({
          content:
            "No Twitch streamers are currently being tracked.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const server = getServer(guildId);
      const channelText = server?.notification_channel_id
        ? `<#${server.notification_channel_id}>`
        : "Not configured";

      const lines = streamers.map(
        (streamer) =>
          `• [${streamer.twitch_display_name}](https://www.twitch.tv/${streamer.twitch_username})`,
      );

      await interaction.reply({
        content:
          `**Twitch notifications**\n` +
          `Channel: ${channelText}\n\n` +
          `**Tracked streamers (${streamers.length})**\n` +
          lines.join("\n"),
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error(
      `Command /notif ${subcommand} failed:`,
      error,
    );

    const errorMessage = {
      content:
        "❌ Something went wrong while running that command. Check the Render logs for details.",
    };

    try {
      if (interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else if (interaction.replied) {
        await interaction.followUp({
          ...errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          ...errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      console.error(
        "Could not send command error response:",
        replyError,
      );
    }
  }
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`SQLite database: ${getDatabasePath()}`);

  // Check once immediately, then every minute.
  await checkStreams();
  setInterval(checkStreams, POLL_INTERVAL_MS);
});

async function start() {
  await deployCommands();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch((error) => {
  console.error("Bot failed to start:", error);
  process.exit(1);
});
