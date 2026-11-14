import { pick } from '../../base/language.ts';
import { S as zhHant } from './strings.zh-Hant.ts';
import { S as ja } from './strings.ja.ts';
import { S as ko } from './strings.ko.ts';
import { S as fr } from './strings.fr.ts';
import { S as de } from './strings.de.ts';
import { S as es419 } from './strings.es-419.ts';
import { S as ptBR } from './strings.pt-BR.ts';
import { S as it } from './strings.it.ts';
import { S as ru } from './strings.ru.ts';

const zh = {
  nav: "Telegram",
  modeTitle: "连接方式",
  modeLabel: "Telegram",
  modeHint: "用自己的机器人时只有你能跟它说话。公司的机器人由管理员设在团队服务器上;每个人连接自己的 Telegram,消息只送到自己的 Buggie。",
  off: "关闭",
  own: "我自己的机器人",
  team: "公司的机器人",
  ownTitle: "你的机器人",
  tokenLabel: "机器人令牌",
  tokenPlaceholder: "粘贴令牌",
  tokenHint: "在 Telegram 里找 @BotFather,发 /newbot 新建一个机器人,把它给的令牌粘贴到这里。令牌作为密钥保存在这台电脑上。",
  save: "保存",
  remove: "移除",
  botIs: "机器人:@{bot}",
  noBot: "还没有机器人。",
  chatLabel: "你的聊天",
  link: "连接我的 Telegram",
  linkHint: "在装了 Telegram 的设备上打开链接并点「开始」,或者把这个代码发给机器人:{code}。10 分钟内有效。",
  openLink: "在 Telegram 中打开",
  linkedAs: "已连接:{name}",
  notLinked: "未连接。",
  unlink: "断开",
  teamTitle: "公司的机器人",
  teamNeeds: "先在「团队」页登录团队服务器。",
  teamBotLabel: "机器人",
  teamNoBot: "公司还没有机器人,由所有者或管理员在这里设置。",
  teamBotHint: "用 @BotFather 新建公司的机器人,把令牌粘贴到这里:它保存在团队服务器上。不要拿某个人自己的机器人来用。",
  notifyLabel: "Telegram 通知",
  always: "总是",
  offline: "只在我的 Buggie 没连接时",
  never: "从不",
  notifyHint: "你的工单的动态:分配给你、被修改、有评论。",
  failed: "没能完成:{why}",
  errors: {
    telegram_token_invalid: "Telegram 不认识这个令牌。",
    unreachable: "连不上 Telegram 或服务器。",
    telegram_unreachable: "团队服务器连不上 Telegram。",
    telegram_no_bot: "还没有机器人。",
    telegram_not_linked: "Telegram 还没连接。",
    telegram_blocked: "机器人在 Telegram 里被屏蔽了。",
    admin_only: "只有所有者和管理员能做这件事。",
    no_org: "先选一个公司。",
  },
};

export const en: typeof zh = {
  nav: "Telegram",
  modeTitle: "Connection",
  modeLabel: "Telegram",
  modeHint: "With your own bot, only you talk to it. The company's bot is set by an admin on the team server; each person links their own Telegram, and messages reach only their Buggie.",
  off: "Off",
  own: "My own bot",
  team: "The company's bot",
  ownTitle: "Your bot",
  tokenLabel: "Bot token",
  tokenPlaceholder: "Paste the token",
  tokenHint: "In Telegram, open @BotFather, send /newbot to create a bot, and paste the token it gives here. It is kept as a secret on this computer.",
  save: "Save",
  remove: "Remove",
  botIs: "Bot: @{bot}",
  noBot: "No bot yet.",
  chatLabel: "Your chat",
  link: "Link my Telegram",
  linkHint: "Open the link on a device with Telegram and press Start, or send the bot this code: {code}. It works for 10 minutes.",
  openLink: "Open in Telegram",
  linkedAs: "Linked: {name}",
  notLinked: "Not linked.",
  unlink: "Unlink",
  teamTitle: "Company bot",
  teamNeeds: "Sign in to the team server on the Team page first.",
  teamBotLabel: "Bot",
  teamNoBot: "The company has no bot yet. An owner or admin sets it here.",
  teamBotHint: "Create the company's bot with @BotFather and paste its token here: it is kept on the team server. Do not use anyone's own bot for it.",
  notifyLabel: "Notices on Telegram",
  always: "Always",
  offline: "Only while my Buggie is not connected",
  never: "Never",
  notifyHint: "News on your tickets: assigned to you, changed, commented on.",
  failed: "Could not do it: {why}",
  errors: {
    telegram_token_invalid: "Telegram does not know that token.",
    unreachable: "Could not reach Telegram or the server.",
    telegram_unreachable: "The team server could not reach Telegram.",
    telegram_no_bot: "There is no bot yet.",
    telegram_not_linked: "Telegram is not linked yet.",
    telegram_blocked: "The bot was blocked in Telegram.",
    admin_only: "Only owners and admins can do this.",
    no_org: "Pick a company first.",
  },
};

export const S = pick({
  zh, en, 'zh-Hant': zhHant, ja, ko, fr, de, 'es-419': es419, 'pt-BR': ptBR, it, ru,
});

/** `template` with each `{name}` replaced by `vars.name`. */
export const fill = (template: string, vars: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
