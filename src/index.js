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
  getStreams,
  getTwitchUser,
} from "./twitch.js";


const requiredEnv = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
];

const missingEnv = requiredEnv.filter(
  (key) => !process.env[key]
);

if (missingEnv.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnv.join(", ")}`
  );
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});


const POLL_INTERVAL_MS = 60_000;

let streamCheckRunning = false;


// ========================================
// HELPERS
// ========================================

function cleanTwitchUsername(input) {
  return input
    .trim()

    // https://twitch.tv/username
    .replace(
      /^https?:\/\/(?:www\.)?twitch\.tv\//i,
      ""
    )

    // twitch.tv/username
    .replace(
      /^twitch\.tv\//i,
      ""
    )

    // remove anything after username
    .replace(
      /\/.*$/,
      ""
    )

    // @username
    .replace(
      /^@/,
      ""
    )

    .toLowerCase();
}


// ========================================
// TWITCH EMBED
// ========================================

function createTwitchEmbed(stream) {
  const username =
    stream.user_login;

  const twitchUrl =
    `https://www.twitch.tv/${username}`;


  let thumbnail =
    stream.thumbnail_url
      .replace(
        "{width}",
        "1280"
      )
      .replace(
        "{height}",
        "720"
      );


  // Helps Discord fetch the current
  // stream thumbnail instead of a
  // previously cached image.
  thumbnail +=
    `?t=${Date.now()}`;


  return new EmbedBuilder()

    .setColor(
      0x9146ff
    )

    .setAuthor({
      name:
        `${stream.user_name} is now live on Twitch!`,
    })

    .setTitle(
      stream.title ||
      "Live on Twitch"
    )

    .setURL(
      twitchUrl
    )

    .addFields(
      {
        name: "Game",

        value:
          stream.game_name ||
          "Unknown",

        inline: false,
      },

      {
        name: "Viewers",

        value:
          Number(
            stream.viewer_count
          ).toLocaleString(),

        inline: false,
      }
    )

    .setImage(
      thumbnail
    )

    .setFooter({
      text: "Twitch",
    })

    .setTimestamp();
}


// ========================================
// SEND LIVE NOTIFICATION
// ========================================

async function sendLiveNotification(
  notification,
  stream
) {
  try {

    const channel =
      await client.channels.fetch(
        notification.notification_channel_id
      );


    if (
      !channel ||
      !channel.isTextBased() ||
      !("guild" in channel)
    ) {

      console.error(
        `Channel ${notification.notification_channel_id} is not a usable guild text channel.`
      );

      return false;
    }


    const me =
      channel.guild.members.me;


    if (me) {

      const permissions =
        channel.permissionsFor(me);


      if (
        !permissions?.has(
          PermissionFlagsBits.SendMessages
        ) ||
        !permissions?.has(
          PermissionFlagsBits.EmbedLinks
        )
      ) {

        console.error(
          `Missing Send Messages or Embed Links in ${channel.guild.name} / #${channel.name}.`
        );

        return false;
      }
    }


    await channel.send({
      embeds: [
        createTwitchEmbed(stream)
      ],
    });


    console.log(
      `🔴 Sent notification for ${stream.user_name} in ${channel.guild.name}.`
    );


    return true;


  } catch (error) {

    console.error(
      `Could not send notification for ${stream.user_name}:`,
      error
    );

    return false;
  }
}


// ========================================
// TWITCH POLLING
// ========================================

async function checkStreams() {

  // Prevent two polls from overlapping
  if (streamCheckRunning) {
    return;
  }


  streamCheckRunning = true;


  try {

    const notifications =
      getAllNotifications();


    if (
      notifications.length === 0
    ) {
      return;
    }


    /*
      Multiple Discord servers may track
      the same Twitch account.

      Only query each Twitch user once.
    */

    const uniqueUserIds = [
      ...new Set(
        notifications.map(
          (row) =>
            row.twitch_user_id
        )
      ),
    ];


    const liveStreams =
      await getStreams(
        uniqueUserIds
      );


    /*
      Twitch user ID
            ↓
      current stream object
    */

    const liveByUserId =
      new Map(
        liveStreams.map(
          (stream) => [
            stream.user_id,
            stream,
          ]
        )
      );


    for (
      const notification
      of notifications
    ) {

      const stream =
        liveByUserId.get(
          notification.twitch_user_id
        );


      // Streamer is offline.
      if (!stream) {
        continue;
      }


      /*
        If their Twitch username or
        display name changed, update our
        stored copy.
      */

      if (
        notification.twitch_username
          !==
        stream.user_login.toLowerCase()

        ||

        notification.twitch_display_name
          !==
        stream.user_name
      ) {

        updateTwitchIdentity(
          stream.user_id,
          stream.user_login,
          stream.user_name
        );
      }


      /*
        If Twitch's current stream ID
        matches the last stream ID we
        successfully notified for,
        we've already handled this stream.
      */

      if (
        notification.last_stream_id
          ===
        stream.id
      ) {

        continue;
      }


      console.log(
        `New Twitch stream detected: ${stream.user_name} (${stream.id})`
      );


      const sent =
        await sendLiveNotification(
          notification,
          stream
        );


      /*
        Only save the stream ID AFTER the
        Discord message successfully sends.

        If Discord fails temporarily,
        the bot will retry next poll.
      */

      if (sent) {

        setLastStreamId(
          notification.guild_id,
          notification.twitch_user_id,
          stream.id
        );
      }
    }


  } catch (error) {

    console.error(
      "Twitch polling failed:",
      error
    );


  } finally {

    streamCheckRunning = false;
  }
}


// ========================================
// SLASH COMMANDS
// ========================================

client.on(
  Events.InteractionCreate,

  async (interaction) => {

    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }


    if (
      interaction.commandName
        !==
      "notif"
    ) {
      return;
    }


    if (
      !interaction.guildId
    ) {
      return;
    }


    const guildId =
      interaction.guildId;


    const subcommand =
      interaction.options
        .getSubcommand();


    try {

      // =================================
      // /notif setup
      // =================================

      if (
        subcommand === "setup"
      ) {

        const channel =
          interaction.options
            .getChannel(
              "channel",
              true
            );


        const botMember =
          interaction.guild
            ?.members.me;


        if (botMember) {

          const permissions =
            channel.permissionsFor(
              botMember
            );


          if (
            !permissions?.has(
              PermissionFlagsBits.SendMessages
            )
          ) {

            await interaction.reply({
              content:
                `❌ I can't send messages in ${channel}. Give me **Send Messages** permission there first.`,

              flags:
                MessageFlags.Ephemeral,
            });

            return;
          }


          if (
            !permissions?.has(
              PermissionFlagsBits.EmbedLinks
            )
          ) {

            await interaction.reply({
              content:
                `❌ I don't have **Embed Links** permission in ${channel}.`,

              flags:
                MessageFlags.Ephemeral,
            });

            return;
          }
        }


        setNotificationChannel(
          guildId,
          channel.id
        );


        // Success response is public.
        await interaction.reply({
          content:
            `✅ Twitch notifications will now be sent in ${channel}.`,
        });


        return;
      }


      // =================================
      // /notif add
      // =================================

      if (
        subcommand === "add"
      ) {

        const input =
          interaction.options
            .getString(
              "twitch",
              true
            );


        const username =
          cleanTwitchUsername(
            input
          );


        if (!username) {

          await interaction.reply({
            content:
              "❌ Please give me a Twitch username or Twitch channel URL.",

            flags:
              MessageFlags.Ephemeral,
          });

          return;
        }


        const server =
          getServer(
            guildId
          );


        if (
          !server
          ?.notification_channel_id
        ) {

          await interaction.reply({
            content:
              "❌ Run `/notif setup` first so I know where to send notifications.",

            flags:
              MessageFlags.Ephemeral,
          });

          return;
        }


        /*
          Twitch lookup may take long enough
          that Discord needs an acknowledgement.

          This defer is public because the
          final success message should be public.
        */

        await interaction.deferReply();


        const twitchUser =
          await getTwitchUser(
            username
          );


        if (!twitchUser) {

          /*
            A reply's ephemeral/public state
            cannot be changed after deferring.

            Delete the public "thinking"
            response and send a private
            follow-up instead.
          */

          await interaction
            .deleteReply()
            .catch(
              () => {}
            );


          await interaction.followUp({
            content:
              `❌ I couldn't find a Twitch channel named **${username}**.`,

            flags:
              MessageFlags.Ephemeral,
          });


          return;
        }


        const existingById =
          getStreamerByUserId(
            guildId,
            twitchUser.id
          );


        if (existingById) {

          await interaction
            .deleteReply()
            .catch(
              () => {}
            );


          await interaction.followUp({
            content:
              `⚠️ **${twitchUser.display_name}** is already being tracked.`,

            flags:
              MessageFlags.Ephemeral,
          });


          return;
        }


        addStreamer(
          guildId,
          twitchUser
        );


        /*
          IMPORTANT:

          We deliberately DO NOT check the
          stream here and DO NOT save its
          current stream.id.

          Therefore:

          streamer already live when added
                  ↓
          last_stream_id = NULL
                  ↓
          next Twitch poll sees current
          stream.id as new
                  ↓
          notification gets sent
                  ↓
          stream.id is saved

          This means adding somebody who is
          already live WILL trigger an embed
          within roughly the next minute.
        */


        await interaction.editReply({
          content:
            `✅ Added **${twitchUser.display_name}** to Twitch notifications.`,
        });


        return;
      }


      // =================================
      // /notif remove
      // =================================

      if (
        subcommand === "remove"
      ) {

        const input =
          interaction.options
            .getString(
              "twitch",
              true
            );


        const username =
          cleanTwitchUsername(
            input
          );


        const existing =
          getStreamerByUsername(
            guildId,
            username
          );


        if (!existing) {

          await interaction.reply({
            content:
              `❌ **${username}** isn't currently being tracked.`,

            flags:
              MessageFlags.Ephemeral,
          });


          return;
        }


        removeStreamer(
          guildId,
          existing.twitch_user_id
        );


        // Success response is public.
        await interaction.reply({
          content:
            `✅ Removed **${existing.twitch_display_name}** from Twitch notifications.`,
        });


        return;
      }


      // =================================
      // /notif list
      // =================================

      if (
        subcommand === "list"
      ) {

        const streamers =
          getGuildStreamers(
            guildId
          );


        if (
          streamers.length === 0
        ) {

          // Normal informational response:
          // public.
          await interaction.reply({
            content:
              "No Twitch streamers are currently being tracked.",
          });


          return;
        }


        const server =
          getServer(
            guildId
          );


        const channelText =
          server
            ?.notification_channel_id

            ? `<#${server.notification_channel_id}>`

            : "Not configured";


        const lines =
          streamers.map(
            (streamer) =>
              `• [${streamer.twitch_display_name}](https://www.twitch.tv/${streamer.twitch_username})`
          );


        // Public list.
        await interaction.reply({
          content:
            `**Twitch notifications**\n` +

            `Channel: ${channelText}\n\n` +

            `**Tracked streamers (${streamers.length})**\n` +

            lines.join("\n"),
        });


        return;
      }


    } catch (error) {

      console.error(
        `Command /notif ${subcommand} failed:`,
        error
      );


      const errorMessage =
        "❌ Something went wrong while running that command. Check the Render logs for details.";


      try {

        /*
          Errors should only be visible
          to the user who ran the command.
        */

        if (
          interaction.deferred
        ) {

          await interaction
            .deleteReply()
            .catch(
              () => {}
            );


          await interaction.followUp({
            content:
              errorMessage,

            flags:
              MessageFlags.Ephemeral,
          });


        } else if (
          interaction.replied
        ) {

          await interaction.followUp({
            content:
              errorMessage,

            flags:
              MessageFlags.Ephemeral,
          });


        } else {

          await interaction.reply({
            content:
              errorMessage,

            flags:
              MessageFlags.Ephemeral,
          });
        }


      } catch (replyError) {

        console.error(
          "Could not send command error response:",
          replyError
        );
      }
    }
  }
);


// ========================================
// READY
// ========================================

client.once(
  Events.ClientReady,

  async (readyClient) => {

    console.log(
      `✅ Logged in as ${readyClient.user.tag}`
    );


    console.log(
      `SQLite database: ${getDatabasePath()}`
    );


    /*
      Check immediately when the bot
      starts.

      Because stream IDs are stored in
      SQLite, restarting the bot will not
      duplicate already-sent streams.
    */

    await checkStreams();


    /*
      Then check every 60 seconds.
    */

    setInterval(
      checkStreams,
      POLL_INTERVAL_MS
    );
  }
);


// ========================================
// START BOT
// ========================================

async function start() {

  /*
    Automatically register/update
    /notif whenever Render starts.
  */

  await deployCommands();


  await client.login(
    process.env.DISCORD_TOKEN
  );
}


start().catch(
  (error) => {

    console.error(
      "Bot failed to start:",
      error
    );


    process.exit(1);
  }
);
