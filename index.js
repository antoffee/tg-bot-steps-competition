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

sqlite.connect("./results.db");

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

const regStemsSet = {};
const editStepsMap = new Map();
bot.on("message", (msg) => {
  // просто волшебная защита данных
  if (!ALLOWED_USERS.includes(msg.from.username)) {
    return;
  }

  const chatId = msg.chat.id;

  const msgUsername = msg.from.username;

  switch (msg.text) {
    case "/start": {
      bot.sendMessage(
        chatId,
        "Привет! Это бот для составления топа по количеству шагов. Он считает даты только в таймзоне +3 (МСК), это влияет на сопоставления времени отправки сообщения и даты в базе данных"
      );
    }
    case "/reg_steps": {
      regStemsSet[msgUsername] = true;
      bot.sendMessage(
        chatId,
        "Отправьте свои шаги за сегодняшний день числом без дополнительных символов. Если вы не хотите записывать шаги, напишите /cancel"
      );
      return;
    }
    case "/edit_steps": {
      editStepsMap.set(msgUsername, null);
      bot.sendMessage(
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
        bot.sendMessage(
          chatId,
          `${data
            .map(
              (item, ind) => `${ind + 1}. @${item.username} ${item?.sum} шагов
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
      const todayMSK = new Date(msg.date * 1000 + 3 * 60 * 60 * 1000);
      const mondayOfWeek = getMonday(todayMSK).toISOString().split("T")[0];
      const data = sqlite.run(
        `SELECT SUM(steps) AS sum,username FROM results WHERE id in(SELECT id FROM results WHERE date >= '${mondayOfWeek}') GROUP BY username ORDER by sum DESC`
      );
      if (data.length) {
        bot.sendMessage(
          chatId,
          `${data
            .map(
              (item, ind) => `${ind + 1}. @${item.username} ${item?.sum} шагов
`
            )
            .join("")}`
        );
      } else {
        bot.sendMessage(chatId, "Нет данных");
      }
      return;
    }
    case "/cancel": {
      delete regStemsSet[msgUsername];
      editStepsMap.delete(msgUsername);
      bot.sendMessage(chatId, "Отменено");
      return;
    }
    case "/my_steps": {
      const data = sqlite.run(
        `SELECT steps, username, date FROM results WHERE username = '${msgUsername}' ORDER BY date`
      );
      if (data.length) {
        bot.sendMessage(
          chatId,
          `${data
            .map(
              (item) => `${item.date}. ${item?.steps} шагов
`
            )
            .join("")}`
        );
      } else {
        bot.sendMessage(chatId, "Нет данных");
      }
      return;
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
        updateOrInsert({
          username: msg.from.username,
          steps: steps,
          date: new Date(msg.date * 1000 + 3 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
        });
        bot.sendMessage(chatId, "Ваши результаты записаны");
        delete regStemsSet[msg.from.username];

        return;
      } else if (regStemsSet[msg.from.username]) {
        bot.sendMessage(
          chatId,
          "Кажется, вы отправили что-то некорректное. Ожидалось количество шагов числом без дополнительных символов."
        );

        return;
      }

      // если пользователь редачит, но еще не ввел дату
      if (editStepsMap.has(msgUsername) && !editStepsMap.get(msgUsername)) {
        const isValid = /\d\d\d\d\-\d\d\-\d\d/.test(msg.text);
        if (isValid) {
          editStepsMap.set(msgUsername, msg.text);
          bot.sendMessage(
            chatId,
            "Теперь отправьте число шагов без дополнительных символов, просто числом"
          );
        } else {
          bot.sendMessage(
            chatId,
            "Кажется, вы ввели что-то не то. Ожидалась дата в формате ГГГГ-ММ-ДД"
          );
        }
      } else if (editStepsMap.get(msgUsername)) {
        const steps = Number(msg.text);
        if (steps < 0 || steps > 150000) {
          bot.sendSticker(
            chatId,
            "https://stickerswiki.ams3.cdn.digitaloceanspaces.com/Myfavoritecats_by_fStikBot/70482.160.gif"
          );
          return;
        }

        updateOrInsert({
          username: msg.from.username,
          steps: steps,
          date: editStepsMap.get(msgUsername),
        });
        bot.sendMessage(chatId, "Ваши результаты обновлены");
        editStepsMap.delete(msgUsername);

        return;
      }
    }
  }
});
