"use strict";

import TelegramBot from "node-telegram-bot-api";

import { config } from "dotenv";

import sqlite from "sqlite-sync";

config();

// replace the value below with the Telegram token you receive from @BotFather
const token = process.env.TELEGRAM_API_TOKEN;

sqlite.connect("./results.db");

sqlite.run(
  `CREATE TABLE IF NOT EXISTS results(
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  steps INTEGER NOT NULL,
  date TEXT NOT NULL
);`,
  function (res) {
    if (res?.error) throw res.error;
  }
);

const ALLOWED_USERS = (process.env.TG_USERNAMES_SECRET ?? "").split(",");

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

bot.setMyCommands([
  { command: "/reg_steps", description: "Записать шаги" },
  { command: "/edit_steps", description: "Редактировать шаги" },
]);

const regStemsSet = {};
// Matches "/echo [whatever]"
// bot.onText(/\/echo (.+)/, (msg, match) => {
//   // 'msg' is the received Message from Telegram
//   // 'match' is the result of executing the regexp above on the text content
//   // of the message

//   const chatId = msg.chat.id;
//   const resp = match[1]; // the captured "whatever"

//   // send back the matched "whatever" to the chat
//   bot.sendMessage(chatId, resp);
// });

// Listen for any kind of message. There are different kinds of
// messages.
bot.on("message", (msg) => {
  // просто волшебная защита данных
  if (!ALLOWED_USERS.includes(msg.from.username)) {
    return;
  }

  const chatId = msg.chat.id;

  console.log(new Date(msg.date * 1000 + 3 * 60 * 60 * 1000).toISOString());

  switch (msg.text) {
    case "/reg_steps": {
      regStemsSet[msg.from.username] = true;
      bot.sendMessage(
        chatId,
        "Отправьте свои шаги числом без дополнительных символов"
      );
      return;
    }
    case "/edit_steps": {
      bot.sendMessage(
        chatId,
        "Отправьте свои шаги числом без дополнительных символов"
      );
      return;
    }
    case "/top_all": {
      const data = sqlite.run(
        "SELECT SUM (steps) as sum, username FROM results GROUP BY username ORDER BY sum"
      );
      if (data.length) {
        bot.sendMessage(
          chatId,
          `Наибольшее количество шагов за всё время: ${data[0]?.sum}, @${data[0].username}`
        );
      } else {
        bot.sendMessage(chatId, "Нет данных");
      }
      return;
    }
    case "/results_week": {
      const data = sqlite.run(
        "SELECT SUM (steps) as sum, username, date FROM results GROUP BY username ORDER BY sum"
      );
    }
    default: {
      if (regStemsSet[msg.from.username] && Number(msg.text)) {
        const steps = Number(msg.text);
        if (steps < 0 || steps > 150000) {
          bot.sendSticker(
            chatId,
            "https://stickerswiki.ams3.cdn.digitaloceanspaces.com/Myfavoritecats_by_fStikBot/70482.160.gif"
          );
          return;
        }
        sqlite.insert("results", {
          username: msg.from.username,
          steps: steps,
          date: new Date(msg.date * 1000 + 3 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
        });
        bot.sendMessage(chatId, "Ваши результаты записаны");
        delete regStemsSet[msg.from.username];
      } else if (regStemsSet[msg.from.username]) {
        bot.sendMessage(chatId, "Кажется, вы отправили что-то некорректное");
      }
    }
  }
});
