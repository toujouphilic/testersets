// /voice — controls for the voice scanner running on the Mac mini.
//
// This file ONLY defines the command so it gets registered along with /notif and
// /chatlog (deploy-commands.js replaces the whole command list on every start).
// This Node bot never answers /voice: the scanner on the Mac logs in with the same
// bot token and handles /voice and its own alert buttons. index.js already ignores
// commands that aren't /notif or /chatlog, so nothing else changes.
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const platformOption = (o) =>
  o.setName("platform").setDescription("twitch or youtube").setRequired(true)
    .addChoices({ name: "Twitch", value: "twitch" }, { name: "YouTube", value: "youtube" });

export const voiceCommand = new SlashCommandBuilder()
  .setName("voice")
  .setDescription("Voice scanner controls (runs on the Mac mini)")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName("scan").setDescription("Scan a Twitch VOD or YouTube video")
    .addStringOption((o) => o.setName("url").setDescription("VOD / video link").setRequired(true))
    .addStringOption((o) => o.setName("start").setDescription("Start from (e.g. 1h20m)")))
  .addSubcommand((s) => s.setName("addfilter").setDescription("Add a YouTube title filter, e.g. [loppezz]")
    .addStringOption((o) => o.setName("keyword").setDescription("Text the title must contain").setRequired(true)))
  .addSubcommand((s) => s.setName("removefilter").setDescription("Remove a title filter")
    .addStringOption((o) => o.setName("keyword").setDescription("Filter to remove").setRequired(true)))
  .addSubcommand((s) => s.setName("filters").setDescription("List title filters"))
  .addSubcommand((s) => s.setName("addchannel").setDescription("Watch a channel for new videos")
    .addStringOption(platformOption)
    .addStringOption((o) => o.setName("name").setDescription("Channel name, @handle or URL").setRequired(true))
    .addStringOption((o) => o.setName("mode").setDescription("How to scan this channel (default: its VODs)")
      .addChoices(
        { name: "Scan VODs", value: "all" },
        { name: "Scan VODs, only titles matching filters", value: "filter" },
        { name: "Live record audio (Twitch, for channels without VODs)", value: "live" })))
  .addSubcommand((s) => s.setName("removechannel").setDescription("Stop watching a channel")
    .addStringOption(platformOption)
    .addStringOption((o) => o.setName("name").setDescription("Channel name").setRequired(true)))
  .addSubcommand((s) => s.setName("channels").setDescription("List watched channels"))
  .addSubcommand((s) => s.setName("stats").setDescription("Scanner stats"))
  .addSubcommandGroup((g) => g.setName("summary").setDescription("Daily summary of where the voice was heard")
    .addSubcommand((s) => s.setName("enable").setDescription("Post the daily summary in a channel of this server")
      .addChannelOption((o) => o.setName("channel").setDescription("Where to post it").setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread,
          ChannelType.AnnouncementThread))
      .addStringOption((o) => o.setName("time").setDescription("When to post it each day, e.g. 23:30 or 11:30pm")))
    .addSubcommand((s) => s.setName("disable").setDescription("Stop posting the daily summary in this server"))
    .addSubcommand((s) => s.setName("preview").setDescription("See today's summary (only you)"))
    .addSubcommand((s) => s.setName("now").setDescription("Post the summary now")));
