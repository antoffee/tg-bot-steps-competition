"use strict";

import TelegramBot from "node-telegram-bot-api";

import { config } from "dotenv";

import sqlite from "sqlite-sync";

function getMonday(d) {
  d = new Date(d);
  var day = d.getDay(),
    diff = d.getDate() - day + (day == 0 ? -6 : 1); // adjust when day is sunday
  return new Date(d.setDate(diff));
}

config();

// replace the value below with the Telegram token you receive from @BotFather
const token = process.env.TELEGRAM_API_TOKEN;

// ?
sqlite.connect("/tmp/results.db");

sqlite.run(
  `CREATE TABLE IF NOT EXISTS results(
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  steps INTEGER NOT NULL,
  date TEXT NOT NULL,
  CONSTRAINT uq_user_date UNIQUE (username, date)
);`,
  function (res) {
    if (res?.error) throw res.error;
  }
);

const updateOrInsert = (data) => {
  const rowsUpdated = sqlite.update(
    "results",
    {
      username: data.username,
      steps: data.steps,
      date: data.date,
    },
    { username: data.username, date: data.date }
  );

  if (rowsUpdated) return;

  sqlite.insert("results", {
    username: data.username,
    steps: data.steps,
    date: data.date,
  });
};

const ALLOWED_USERS = (process.env.TG_USERNAMES_SECRET ?? "").split(",");

const regStemsSet = {};
const editStepsMap = new Map();

export default async (request, response) => {
  // Create a bot that uses 'polling' to fetch new updates
  const bot = new TelegramBot(token, { polling: true });

  bot.setMyCommands([
    { command: "/reg_steps", description: "Записать шаги" },
    { command: "/edit_steps", description: "Редактировать шаги" },
    { command: "/top_all", description: "ТОП результатов за всё время" },
    { command: "/top_week", description: "ТОП результатов за текущую неделю" },
    { command: "/cancel", description: "Отмена действия" },
    { command: "/my_steps", description: "Просмотр своих шагов" },
  ]);
  try {
    // Retrieve the POST request body that gets sent from Telegram
    const { body } = request;

    // Ensure that this is a message being sent
    if (body?.message) {
      // Retrieve the ID for this chat
      // and the text that the user sent
      const {
        chat: { id: chatId },
        text,
        from: { username: msgUsername },
        date,
      } = body.message;

      // Create a message to send back
      // We can use Markdown inside this
      const message = `✅ Thanks for your message: *"${text}"*\nHave a great day! 👋🏻`;

      // Send our new message back in Markdown and
      // wait for the request to finish
      // просто волшебная защита данных
      if (!ALLOWED_USERS.includes(msgUsername)) {
        return;
      }

      switch (text) {
        case "/start": {
          await bot.sendMessage(
            chatId,
            "Привет! Это бот для составления топа по количеству шагов. Он считает даты только в таймзоне +3 (МСК), это влияет на сопоставления времени отправки сообщения и даты в базе данных"
          );
        }
        case "/reg_steps": {
          regStemsSet[msgUsername] = true;
          await bot.sendMessage(
            chatId,
            "Отправьте свои шаги за сегодняшний день числом без дополнительных символов. Если вы не хотите записывать шаги, напишите /cancel"
          );
          return;
        }
        case "/edit_steps": {
          editStepsMap.set(msgUsername, null);
          await bot.sendMessage(
            chatId,
            "Отправьте число, за которое вы хотите скорректировать результаты в формате ГГГГ-ММ-ДД. Если хотите выполнить другое действие, отправьте /cancel"
          );
          return;
        }
        case "/top_all": {
          const data = sqlite.run(
            "SELECT SUM (steps) as sum, username FROM results GROUP BY username ORDER BY sum DESC"
          );
          if (data.length) {
            await bot.sendMessage(
              chatId,
              `${data
                .map(
                  (item, ind) => `${ind + 1}. @${item.username} ${
                    item?.sum
                  } шагов
`
                )
                .join("")}`
            );
          } else {
            bot.sendMessage(chatId, "Нет данных");
          }
          return;
        }
        case "/top_week": {
          const todayMSK = new Date(date * 1000 + 3 * 60 * 60 * 1000);
          const mondayOfWeek = getMonday(todayMSK).toISOString().split("T")[0];
          const data = sqlite.run(
            `SELECT SUM(steps) AS sum,username FROM results WHERE id in(SELECT id FROM results WHERE date >= '${mondayOfWeek}') GROUP BY username ORDER by sum DESC`
          );
          if (data.length) {
            await bot.sendMessage(
              chatId,
              `${data
                .map(
                  (item, ind) => `${ind + 1}. @${item.username} ${
                    item?.sum
                  } шагов
`
                )
                .join("")}`
            );
          } else {
            await bot.sendMessage(chatId, "Нет данных");
          }
          return;
        }
        case "/cancel": {
          delete regStemsSet[msgUsername];
          editStepsMap.delete(msgUsername);
          await bot.sendMessage(chatId, "Отменено");
          return;
        }
        case "/my_steps": {
          const data = sqlite.run(
            `SELECT steps, username, date FROM results WHERE username = '${msgUsername}' ORDER BY date`
          );
          if (data.length) {
            await bot.sendMessage(
              chatId,
              `${data
                .map(
                  (item) => `${item.date}. ${item?.steps} шагов
`
                )
                .join("")}`
            );
          } else {
            await bot.sendMessage(chatId, "Нет данных");
          }
          return;
        }
        default: {
          if (regStemsSet[msgUsername] && Number(text)) {
            const steps = Number(text);
            if (steps < 0 || steps > 150000) {
              await bot.sendSticker(
                chatId,
                "https://stickerswiki.ams3.cdn.digitaloceanspaces.com/Myfavoritecats_by_fStikBot/70482.160.gif"
              );
              return;
            }
            updateOrInsert({
              username: msgUsername,
              steps: steps,
              date: new Date(date * 1000 + 3 * 60 * 60 * 1000)
                .toISOString()
                .split("T")[0],
            });
            bot.sendMessage(chatId, "Ваши результаты записаны");
            delete regStemsSet[msgUsername];

            return;
          } else if (regStemsSet[msgUsername]) {
            await bot.sendMessage(
              chatId,
              "Кажется, вы отправили что-то некорректное. Ожидалось количество шагов числом без дополнительных символов."
            );

            return;
          }

          // если пользователь редачит, но еще не ввел дату
          if (editStepsMap.has(msgUsername) && !editStepsMap.get(msgUsername)) {
            const isValid = /\d\d\d\d\-\d\d\-\d\d/.test(text);
            if (isValid) {
              editStepsMap.set(msgUsername, text);
              await bot.sendMessage(
                chatId,
                "Теперь отправьте число шагов без дополнительных символов, просто числом"
              );
            } else {
              await bot.sendMessage(
                chatId,
                "Кажется, вы ввели что-то не то. Ожидалась дата в формате ГГГГ-ММ-ДД"
              );
            }
          } else if (editStepsMap.get(msgUsername)) {
            const steps = Number(text);
            if (steps < 0 || steps > 150000) {
              await bot.sendSticker(
                chatId,
                "https://stickerswiki.ams3.cdn.digitaloceanspaces.com/Myfavoritecats_by_fStikBot/70482.160.gif"
              );
              return;
            }

            updateOrInsert({
              username: msgUsername,
              steps: steps,
              date: editStepsMap.get(msgUsername),
            });
            await bot.sendMessage(chatId, "Ваши результаты обновлены");
            editStepsMap.delete(msgUsername);

            return;
          }
        }
      }
    } else {
      console.error({ request, response });
      response.send(request);
    }
  } catch (error) {
    // If there was an error sending our message then we
    // can log it into the Vercel console
    console.error("Error sending message");
    console.log(error.toString());
  }

  // Acknowledge the message with Telegram
  // by sending a 200 HTTP status code
  // The message here doesn't matter.
  response.send("OK");
};
