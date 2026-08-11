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

import {
  deployCommands,
} from "./deploy-commands.js";

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


const missingEnv =
  requiredEnv.filter(
    (key) => !process.env[key]
  );


if (missingEnv.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnv.join(", ")}`
  );
}


const client =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
    ],
  });


const POLL_INTERVAL_MS =
  60_000;


let streamCheckRunning =
  false;


// ========================================
// HELPERS
// ========================================

function cleanTwitchUsername(
  input
) {
  return input
    .trim()

    .replace(
      /^https?:\/\/(?:www\.)?twitch\.tv\//i,
      ""
    )

    .replace(
      /^twitch\.tv\//i,
      ""
    )

    .replace(
      /\/.*$/,
      ""
    )

    .replace(
      /^@/,
      ""
    )

    .toLowerCase();
}


// ========================================
// TWITCH EMBED
// ========================================

function createTwitchEmbed(
  stream
) {

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
        name:
          "Game",

        value:
          stream.game_name ||
          "Unknown",

        inline:
          false,
      },

      {
        name:
          "Viewers",

        value:
          Number(
            stream.viewer_count
          ).toLocaleString(),

        inline:
          false,
      }
    )

    .setImage(
      thumbnail
    )

    .setFooter({
      text:
        "Twitch",
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
        `Channel ${notification.notification_channel_id} is not a usable text channel or thread.`
      );

      return false;
    }


    const me =
      channel.guild.members.me;


    if (me) {

      const permissions =
        channel.permissionsFor(
          me
        );


      const isThread =
        channel.isThread();


      const canSend =
        isThread

          ? permissions?.has(
              PermissionFlagsBits.SendMessagesInThreads
            )

          : permissions?.has(
              PermissionFlagsBits.SendMessages
            );


      const canEmbed =
        permissions?.has(
          PermissionFlagsBits.EmbedLinks
        );


      if (
        !canSend ||
        !canEmbed
      ) {

        console.error(
          `Missing permission to send Twitch notifications in ${channel.guild.name} / ${channel.name}.`
        );

        return false;
      }
    }


    await channel.send({
      embeds: [
        createTwitchEmbed(
          stream
        ),
      ],
    });


    console.log(
      `Sent notification for ${stream.user_name} in ${channel.guild.name} / ${channel.name}.`
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

  if (
    streamCheckRunning
  ) {
    return;
  }


  streamCheckRunning =
    true;


  try {

    const notifications =
      getAllNotifications();


    if (
      notifications.length === 0
    ) {
      return;
    }


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


      if (!stream) {
        continue;
      }


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

    streamCheckRunning =
      false;
  }
}


// ========================================
// SLASH COMMANDS
// ========================================

client.on(
  Events.InteractionCreate,

  async (
    interaction
  ) => {

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
        subcommand ===
        "setup"
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


        if (
          botMember
        ) {

          const permissions =
            channel.permissionsFor(
              botMember
            );


          const isThread =
            channel.isThread();


          const canSend =
            isThread

              ? permissions?.has(
                  PermissionFlagsBits.SendMessagesInThreads
                )

              : permissions?.has(
                  PermissionFlagsBits.SendMessages
                );


          if (
            !canSend
          ) {

            await interaction.reply({
              content:
                isThread

                  ? `I can't send messages in ${channel}. Give me Send Messages in Threads permission first.`

                  : `I can't send messages in ${channel}. Give me Send Messages permission first.`,

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
                `I don't have Embed Links permission in ${channel}.`,

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


        await interaction.reply({
          content:
            `Twitch notifications will now be sent in ${channel}.`,
        });


        return;
      }


      // =================================
      // /notif add
      // =================================

      if (
        subcommand ===
        "add"
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


        if (
          !username
        ) {

          await interaction.reply({
            content:
              "Please give me a Twitch username or Twitch channel URL.",

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
              "Run `/notif setup` first so I know where to send notifications.",

            flags:
              MessageFlags.Ephemeral,
          });


          return;
        }


        await interaction.deferReply();


        const twitchUser =
          await getTwitchUser(
            username
          );


        if (
          !twitchUser
        ) {

          await interaction
            .deleteReply()
            .catch(
              () => {}
            );


          await interaction.followUp({
            content:
              `I couldn't find a Twitch channel named **${username}**.`,

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


        if (
          existingById
        ) {

          await interaction
            .deleteReply()
            .catch(
              () => {}
            );


          await interaction.followUp({
            content:
              `**${twitchUser.display_name}** is already being tracked.`,

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
          Do not save a current stream ID here.

          If the streamer is already live,
          last_stream_id stays NULL.

          The next Twitch poll will see the
          current stream as new and send the
          notification.
        */


        await interaction.editReply({
          content:
            `Added **${twitchUser.display_name}** to Twitch notifications.`,
        });


        return;
      }


      // =================================
      // /notif remove
      // =================================

      if (
        subcommand ===
        "remove"
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


        if (
          !existing
        ) {

          await interaction.reply({
            content:
              `**${username}** isn't currently being tracked.`,

            flags:
              MessageFlags.Ephemeral,
          });


          return;
        }


        removeStreamer(
          guildId,
          existing.twitch_user_id
        );


        await interaction.reply({
          content:
            `Removed **${existing.twitch_display_name}** from Twitch notifications.`,
        });


        return;
      }


      // =================================
      // /notif list
      // =================================

      if (
        subcommand ===
        "list"
      ) {

        const streamers =
          getGuildStreamers(
            guildId
          );


        if (
          streamers.length === 0
        ) {

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


        const header =
          `**Twitch notifications**\n` +
          `Channel: ${channelText}\n\n` +
          `**Tracked streamers (${streamers.length})**\n`;


        /*
          Streamer names are:
          - bold
          - clickable
          - linked to Twitch
        */

        const lines =
          streamers.map(
            (
              streamer
            ) =>
              `• **[${streamer.twitch_display_name}](https://www.twitch.tv/${streamer.twitch_username})**`
          );


        /*
          Discord limits message content
          to 2000 characters.

          Split long lists automatically.
        */

        const messages =
          [];


        let currentMessage =
          header;


        for (
          const line
          of lines
        ) {

          const nextLine =
            `${line}\n`;


          if (
            (
              currentMessage +
              nextLine
            ).length > 2000
          ) {

            messages.push(
              currentMessage.trimEnd()
            );


            currentMessage =
              `**Tracked streamers continued**\n${nextLine}`;

          } else {

            currentMessage +=
              nextLine;
          }
        }


        if (
          currentMessage.length > 0
        ) {

          messages.push(
            currentMessage.trimEnd()
          );
        }


        /*
          SuppressEmbeds prevents Twitch
          links from generating preview cards.

          The names remain clickable.
        */

        await interaction.reply({
          content:
            messages[0],

          flags:
            MessageFlags.SuppressEmbeds,
        });


        /*
          Any additional chunks are also
          public, with link previews suppressed.
        */

        for (
          let i = 1;
          i < messages.length;
          i++
        ) {

          await interaction.followUp({
            content:
              messages[i],

            flags:
              MessageFlags.SuppressEmbeds,
          });
        }


        return;
      }


    } catch (
      error
    ) {

      console.error(
        `Command /notif ${subcommand} failed:`,
        error
      );


      const errorMessage =
        "Something went wrong while running that command. Check the Render logs for details.";


      try {

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


      } catch (
        replyError
      ) {

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

  async (
    readyClient
  ) => {

    console.log(
      `Logged in as ${readyClient.user.tag}`
    );


    console.log(
      `SQLite database: ${getDatabasePath()}`
    );


    await checkStreams();


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

  await deployCommands();


  await client.login(
    process.env.DISCORD_TOKEN
  );
}


start().catch(
  (
    error
  ) => {

    console.error(
      "Bot failed to start:",
      error
    );


    process.exit(
      1
    );
  }
);
