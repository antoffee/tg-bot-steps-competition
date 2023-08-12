import TelegramBot from "node-telegram-bot-api";

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import { VercelRequest, VercelResponse } from "@vercel/node";

function getMonday(d: Date) {
  d = new Date(d);
  var day = d.getDay(),
    diff = d.getDate() - day + (day == 0 ? -6 : 1); // adjust when day is sunday
  return new Date(d.setDate(diff));
}

config();

// replace the value below with the Telegram token you receive from @BotFather
const token = process.env.TELEGRAM_API_TOKEN;

const updateOrInsert = async (data: Record<string, string | number>) => {
  const { rowCount } =
    await sql`UPDATE results SET username = ${data.username}, steps = ${data.steps}, date = ${data.date} WHERE username = ${data.username} AND date = ${data.date}`;
  // update(
  //   "results",
  //   {
  //     username: data.username,
  //     steps: data.steps,
  //     date: data.date,
  //   },
  //   { username: data.username, date: data.date }
  // );

  if (rowCount) return;
  await sql`INSERT INTO results (username, steps, date) VALUES (${data.username}, ${data.steps}, ${data.date} )`;

  // sqlite.insert("results", {
  //   username: data.username,
  //   steps: data.steps,
  //   date: data.date,
  // });
};

const ALLOWED_USERS = (process.env.TG_USERNAMES_SECRET ?? "").split(",");

const regStemsSet = new Set();
const editStepsMap = new Map();
let flag = true;
export default async (request: VercelRequest, response: VercelResponse) => {
  // Create a bot that uses 'polling' to fetch new updates
  const bot = new TelegramBot(token!, { polling: true });

  if (flag) {
    await sql`CREATE TABLE IF NOT EXISTS results(
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      steps INTEGER NOT NULL,
      date TEXT NOT NULL
      );`
      .catch(console.error)
      .then(() => {
        flag = false;
      });
  }

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
          return;
        }
        case "/reg_steps": {
          regStemsSet.add(msgUsername);
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
          const { rows: data } =
            await sql`SELECT SUM (steps) as sum, username FROM results GROUP BY username ORDER BY sum DESC`;
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
          const { rows: data } =
            await sql`SELECT SUM(steps) AS sum,username FROM results WHERE id in(SELECT id FROM results WHERE date >= '${mondayOfWeek}') GROUP BY username ORDER by sum DESC`;
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
          regStemsSet.delete(msgUsername);
          editStepsMap.delete(msgUsername);
          await bot.sendMessage(chatId, "Отменено");
          return;
        }
        case "/my_steps": {
          const { rows: data } =
            await sql`SELECT steps, username, date FROM results WHERE username = ${msgUsername} ORDER BY date`;

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
          if (regStemsSet.has(msgUsername) && Number(text)) {
            const steps = Number(text);
            if (steps < 0 || steps > 150000) {
              await bot.sendSticker(
                chatId,
                "https://stickerswiki.ams3.cdn.digitaloceanspaces.com/Myfavoritecats_by_fStikBot/70482.160.gif"
              );
              return;
            }
            await updateOrInsert({
              username: msgUsername,
              stexps: steps,
              date: new Date(date * 1000 + 3 * 60 * 60 * 1000)
                .toISOString()
                .split("T")[0],
            });
            bot.sendMessage(chatId, "Ваши результаты записаны");
            regStemsSet.delete(msgUsername);

            return;
          } else if (regStemsSet.has(msgUsername)) {
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
      response.send("OK");
    }
  } catch (error) {
    // If there was an error sending our message then we
    // can log it into the Vercel console
    console.error("Error sending message");
    console.log((error as Error).toString());
    response.status(500).send({ error: (error as Error).toString() });
  }

  // Acknowledge the message with Telegram
  // by sending a 200 HTTP status code
  // The message here doesn't matter.
  response.send("OK");
};
