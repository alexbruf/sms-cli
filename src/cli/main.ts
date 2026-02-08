#!/usr/bin/env bun
import { Command } from "commander";
import { SmsClient } from "./client.ts";
import { listCommand } from "./commands/list.ts";
import { conversationsCommand } from "./commands/conversations.ts";
import { readCommand } from "./commands/read.ts";
import { sendCommand } from "./commands/send.ts";
import { replyCommand } from "./commands/reply.ts";
import { markReadCommand, markUnreadCommand } from "./commands/mark.ts";
import { deleteCommand } from "./commands/delete.ts";
import { searchCommand } from "./commands/search.ts";
import { contactCommand } from "./commands/contact.ts";
import { configCommand } from "./commands/config.ts";

const program = new Command()
  .name("sms")
  .description("SMS inbox CLI")
  .version("1.0.0")
  .action(async () => {
    try {
      const client = new SmsClient();
      const health = await client.health();
      if (health.unread_count > 0) {
        console.log(`${health.unread_count} unread message(s)`);
      } else {
        console.log("No unread messages.");
      }
    } catch (e: unknown) {
      console.error(
        `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      process.exit(1);
    }
  });

program.addCommand(listCommand);
program.addCommand(conversationsCommand);
program.addCommand(readCommand);
program.addCommand(sendCommand);
program.addCommand(replyCommand);
program.addCommand(markReadCommand);
program.addCommand(markUnreadCommand);
program.addCommand(deleteCommand);
program.addCommand(searchCommand);
program.addCommand(contactCommand);
program.addCommand(configCommand);

program.parse();
