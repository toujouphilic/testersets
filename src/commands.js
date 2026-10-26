import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const notifCommand = new SlashCommandBuilder()
  .setName("notif")
  .setDescription("Manage Twitch notifications")
  .setDMPermission(false)
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ManageGuild
  )

  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
      .setDescription(
        "Set the channel or thread for Twitch notifications"
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription(
            "Channel or thread where Twitch notifications will be sent"
          )
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread
          )
          .setRequired(true)
      )
  )

  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription(
        "Add a Twitch streamer to notifications"
      )
      .addStringOption((option) =>
        option
          .setName("twitch")
          .setDescription(
            "Twitch username or channel URL"
          )
          .setRequired(true)
      )
  )

  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription(
        "Remove a Twitch streamer from notifications"
      )
      .addStringOption((option) =>
        option
          .setName("twitch")
          .setDescription(
            "Twitch username or channel URL"
          )
          .setRequired(true)
      )
  )

  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription(
        "List all tracked Twitch streamers"
      )
  );

export const chatlogCommand = new SlashCommandBuilder().setName('chatlog').setDescription('Manage Twitch chat logging').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
.addSubcommand(s=>s.setName('setup').setDescription('Choose Discord destination').addChannelOption(o=>o.setName('channel').setDescription('Discord channel or thread').addChannelTypes(ChannelType.GuildText,ChannelType.PublicThread,ChannelType.PrivateThread,ChannelType.AnnouncementThread).setRequired(true)))
.addSubcommand(s=>s.setName('addchannel').setDescription('Watch a user in a Twitch chat').addStringOption(o=>o.setName('user').setDescription('Twitch username to log').setRequired(true)).addStringOption(o=>o.setName('twitch').setDescription('Twitch chat to watch').setRequired(true)))
.addSubcommand(s=>s.setName('removechannel').setDescription('Stop watching a user in a Twitch chat').addStringOption(o=>o.setName('user').setDescription('Twitch username').setRequired(true)).addStringOption(o=>o.setName('twitch').setDescription('Twitch chat').setRequired(true)))
.addSubcommand(s=>s.setName('list').setDescription('List watched users and chats'))
.addSubcommand(s=>s.setName('nuke').setDescription('Remove ALL watched user/chat pairs for this server').addStringOption(o=>o.setName('confirm').setDescription('Type NUKE to confirm deleting every pair').setRequired(true)));
export const commands = [
  chatlogCommand.toJSON(),
  notifCommand.toJSON(),
];
