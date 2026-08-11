import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

export async function deployCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    throw new Error(
      "DISCORD_TOKEN and DISCORD_CLIENT_ID must be set before commands can be registered.",
    );
  }

  const rest = new REST({ version: "10" }).setToken(token);

  console.log("Registering /notif command with Discord...");

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });

  console.log("Discord slash command registered.");
}
