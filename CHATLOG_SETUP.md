# Multi-user Twitch chat logger

Existing `/notif` commands remain unchanged.

Use `/chatlog setup channel:<Discord channel>` to choose the destination.
Use `/chatlog addchannel user:rekrap2 twitch:mongey` to log rekrap2 in mongey's chat only.
Use `/chatlog addchannel user:epaxial twitch:epaxial` to log epaxial in their own chat.
Use `/chatlog removechannel user:rekrap2 twitch:mongey` to remove one pairing.
Use `/chatlog list` to display all watched pairs in the Discord server.

Each Discord server has its own watches and destination. A Twitch chat is joined only once even if multiple watched users are configured. Re-add previous watches after upgrading, because the old channel-only configuration is not automatically migrated.

Required environment variables: `TWITCH_CHAT_OAUTH_TOKEN`, `TWITCH_CHAT_BOT_USERNAME` plus the existing Twitch API credentials. `CHATLOG_USERNAME` is no longer used. Chat OAuth token renewal is not implemented. Deploy slash commands after updating the bot.

To remove **all** watched user/chat pairs in this Discord server, use `/chatlog nuke confirm:NUKE`. This keeps the Discord output destination and other servers' pairs. Requires Manage Server permissions, like the other chatlog commands.
