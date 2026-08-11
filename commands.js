import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const notifCommand = new SlashCommandBuilder()
  .setName("notif")
  .setDescription("Manage Twitch notifications")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
      .setDescription("Set the channel for Twitch notifications")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel where Twitch notifications will be sent")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )

  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Add a Twitch streamer to notifications")
      .addStringOption((option) =>
        option
          .setName("twitch")
          .setDescription("Twitch username or channel URL")
          .setRequired(true),
      ),
  )

  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a Twitch streamer from notifications")
      .addStringOption((option) =>
        option
          .setName("twitch")
          .setDescription("Twitch username or channel URL")
          .setRequired(true),
      ),
  )

  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("List all tracked Twitch streamers"),
  );

export const commands = [notifCommand.toJSON()];
