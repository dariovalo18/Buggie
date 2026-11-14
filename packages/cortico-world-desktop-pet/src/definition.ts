import { join } from 'node:path';
import type { Language } from 'cortico/core/language.ts';
import { runtimesRoot, modelsRoot } from 'cortico/paths.ts';
import { describeTools, type WorldDefinition, type WorldDescribe } from 'cortico/world.ts';
import { DESKTOP_PET_DEFAULTS, DESKTOP_PET_ID, DESKTOP_PET_SECRETS, type DesktopPetConfigSection, type PetSkin } from './config.ts';
import { DesktopPetWorld, modelsDirFor, type PetBotControls } from './world.ts';
import type { DescribeTool } from './status.ts';
import type { ModelLanguage } from './model-text.ts';
import type { Answer } from './cua/engine-ipc.ts';
import { CUA_OFF_TOOL_DECLS, CUA_TOOL_DECLS } from './cua/tools.ts';
import { petToolDecls } from './tools.ts';
import { TEAM_TOOL_DECLS } from './team-tools.ts';
import { SELF_TYPE } from './chat.ts';
import { petText } from './i18n/index.ts';

/** Every tool the World can give (the computer-use ones while computer use is on, the way to its switch while it is off) and every event it pushes. */
const DESCRIBE: WorldDescribe = {
  tools: describeTools([...petToolDecls(), ...TEAM_TOOL_DECLS, ...CUA_OFF_TOOL_DECLS, ...CUA_TOOL_DECLS], {
    pet_say: { zh: '在桌宠头顶的气泡里说话,可在话里穿插表情与动作。', en: 'Speaks in a bubble above the pet, with expressions and motions in between.' },
    pet_ask: { zh: '弹出带至多 3 个选项的提问气泡,回答之后作为事件送回。', en: 'Asks a question in a bubble with up to 3 options; the answer comes back later as an event.' },
    pet_move_to: { zh: '沿屏幕底边走到或跑到某个位置,或去形象包自带的目标。', en: "Walks or runs along the bottom edge of the screen to a position, or goes to one of the figure pack's own targets." },
    pet_set: { zh: '修改桌宠自己的外观与习惯;按使用者的设置直接生效,或先在气泡里询问。', en: "Changes the pet's own looks and habits, at once or after asking in a bubble, as the person's settings say." },
    pet_quiet: { zh: '安静一段时间:关掉音效、停止走动,到时恢复。', en: 'Keeps quiet for a while: sound effects off and standing still until the time is up.' },
    pet_act: { zh: '不说话,播放一串表情或动作。', en: 'Plays a sequence of expressions or motions without speaking.' },
    pet_see_self: { zh: '取一张桌宠身体此刻在屏幕上的图,不含气泡和桌面。', en: "Takes a picture of the pet's body as it is on screen right now, without bubbles or the desktop." },
    team_info: { zh: '读取团队服务器:登录的帐号、组织、成员、工作组和项目。', en: 'Reads the team server: the account signed in, the org, its members, work groups and projects.' },
    ticket_list: { zh: '列出团队服务器上的工单,可按项目、工作组、状态、负责人和文字筛选。', en: 'Lists tickets on the team server, by project, work group, status, assignee and text.' },
    ticket_get: { zh: '读取一张工单,含正文、来源和评论。', en: 'Reads one ticket with its body, source and comments.' },
    ticket_create: { zh: '在团队服务器的某个项目里新建工单。', en: 'Opens a ticket in a project on the team server.' },
    ticket_update: { zh: '修改工单的状态、负责人、工作组、优先级、标题或正文。', en: "Changes a ticket's status, assignee, work group, priority, title or body." },
    ticket_comment: { zh: '在工单下评论。', en: 'Comments on a ticket.' },
    pet_cua_open_settings: { zh: '电脑操作关着时,把设置窗口打开到它的开关,附风险说明。', en: 'While computer use is off, opens the settings window at its switch, with what it risks.' },
    pet_cua_screenshot: { zh: '截取一块显示器,附鼠标位置与前台窗口标题。', en: 'Captures one display, with the pointer position and the foreground window title.' },
    pet_cua_zoom: { zh: '从屏幕重新截取截图里的一块,读看不清的小字。', en: 'Captures a region of the screenshot again from the screen, for small text.' },
    pet_cua_click: { zh: '把鼠标移到某处并点击。', en: 'Moves the mouse to a point and clicks.' },
    pet_cua_move: { zh: '只移动鼠标,不点击。', en: 'Moves the mouse without clicking.' },
    pet_cua_drag: { zh: '按住左键从一处拖到另一处。', en: 'Drags with the left button from one point to another.' },
    pet_cua_mouse_down: { zh: '在某处按下鼠标键,不松开。', en: 'Presses a mouse button at a point and leaves it down.' },
    pet_cua_mouse_up: { zh: '松开鼠标键。', en: 'Releases a mouse button.' },
    pet_cua_scroll: { zh: '在某处滚动鼠标滚轮。', en: 'Turns the mouse wheel at a point.' },
    pet_cua_type: { zh: '在当前输入焦点输入文字。', en: 'Types text at the current input focus.' },
    pet_cua_key: { zh: '按下一个键或组合键,可以按住几秒再松开。', en: 'Presses a key or a key combination, or holds it down for some seconds.' },
    pet_cua_windows: { zh: '列出可见的顶层窗口。', en: 'Lists the visible top-level windows.' },
    pet_cua_focus: { zh: '把一个窗口切到前台。', en: 'Brings a window to the foreground.' },
    pet_cua_wait: { zh: '等待几秒,然后截图。', en: 'Waits a few seconds, then takes a screenshot.' },
  }),
  events: [
    {
      type: 'desktop-pet.message',
      description: { zh: '使用者在气泡里或对话页上打了字,对话页上的可带图片。', en: 'The person typed a message in the bubble or on the chat page; one from the chat page may carry images.' },
      trigger: 'preempt',
    },
    {
      type: 'desktop-pet.speech',
      description: { zh: '使用者说的话,识别成的文字。用说话键说的话打断当前一轮;一直收音时听到的话以 flush 投递,不打断。', en: 'What the person said, as recognized text. Speech through the talk key interrupts the current round; speech heard while always listening is delivered with flush and does not interrupt.' },
      trigger: 'interrupt',
    },
    {
      type: 'desktop-pet.answer',
      description: { zh: 'pet_ask 问题的回答,或问题没有回答就被关掉。', en: 'The answer to a pet_ask question, or the question closed unanswered.' },
    },
    {
      type: 'desktop-pet.touch',
      description: { zh: '使用者戳、摸、扔出或拎起放下了桌宠。', en: 'The person poked, patted, threw or dropped the pet.' },
    },
    {
      type: 'desktop-pet.talk-key',
      description: { zh: '说话键读不到,语音输入开着时每次运行每种原因一条。', en: 'The talk key cannot be read; once a run for each reason, while voice input is on.' },
    },
    {
      type: 'desktop-pet.figure',
      description: { zh: '使用者换了形象或装扮,或形象没能加载。', en: 'The person switched the figure or its dress, or a figure failed to load.' },
    },
    {
      type: 'desktop-pet.build',
      description: { zh: '使用者用 buggie-watch 跑的构建或测试失败了,或之前的问题修好了;每个问题是屏幕上的一只虫子。', en: "A build or test run the person started with buggie-watch failed, or the earlier problems are fixed; each problem is a bug on the screen." },
    },
    {
      type: 'desktop-pet.explain',
      description: { zh: '使用者点了屏幕上的一只虫子,或复制了一段报错并接受了解释,想听你解释问题和怎么修。', en: 'The person clicked a bug on the screen, or copied an error and accepted the offer to explain it, and wants the problem and its fix explained.' },
      trigger: 'preempt',
    },
    {
      type: 'desktop-pet.focus',
      description: { zh: '使用者开始或提前结束了一段专注,或专注转入休息、休息结束。', en: 'The person started or ended a focus block early, or a block turned into its break, or the break ended.' },
    },
    {
      type: 'desktop-pet.github',
      description: { zh: '使用者在 GitHub 上关于拉取请求和议题的新通知。', en: "The person's new GitHub notifications on pull requests and issues." },
      trigger: 'debounce',
    },
    {
      type: 'desktop-pet.team',
      description: { zh: '团队服务器上和使用者有关的新动态:分配给对方的工单、对方工作组里的新工单、对方工单的修改和评论、对方被加进工作组或项目。', en: 'News on the team server about the person: a ticket assigned to them, a new ticket in their work group, a change or comment on their tickets, their addition to a work group or project.' },
      trigger: 'debounce',
    },
    {
      type: 'desktop-pet.ticket',
      description: { zh: '使用者想为屏幕上的一只虫子在团队服务器上开工单。', en: 'The person wants a ticket on the team server for a bug on the screen.' },
      trigger: 'preempt',
    },
    {
      type: SELF_TYPE,
      description: { zh: '桌宠自己说的话与做的事,只给对话页显示,不送给 bot。', en: 'What the pet said and did, kept for the chat page and never delivered to the bot.' },
    },
  ],
};

export interface DesktopPetAssembly {
  /** The bot's name as it is now, read at each use, so a rename needs no restart; the name at mount (`ctx.botName`) when absent. */
  botName?(): string;
  /** Run controls for the menu header; see `PetBotControls`. */
  controls?: PetBotControls;
  /** Called with each World instance Core creates, for an app that calls `confirm` on it. */
  onCreate?(world: DesktopPetWorld): void;
  /** Called after the dressing page saves a look, with that look as saved. */
  onSkin?(skin: PetSkin): void;
  /** More directories of installed figure packs, besides `figures/` in the data directory. */
  packRoots?(): string[];
  /** Called after the bot changed its own settings (`pet_set`). */
  onBotChange?(): void;
  /** Called when the pet window comes onto the desktop or leaves it (`onDesktop` of the pet panel's state). */
  onDesktopChange?(onDesktop: boolean): void;
  /** What the status bubble shows for a tool call; see `DescribeTool`. */
  describeTool?: DescribeTool;
  /** The language of what the bot reads from this World, read at each use; Chinese when absent. */
  modelLanguage?(): ModelLanguage;
  /** The language the bot is to talk to the person in; see `DesktopPetWorldOptions.replyLanguage`. */
  replyLanguage?(): string | null;
  /** The app language, what the person reads; see `DesktopPetWorldOptions.language`. */
  language?(): Language;
  /** Called with each answer to computer use's question in the pet's bubble. */
  onCuaAnswer?(answer: Answer): void;
}

/** The definition, with what an embedding app lends the World. */
export function desktopPetDefinition(assembly: DesktopPetAssembly = {}): WorldDefinition<DesktopPetConfigSection> {
  return {
    id: DESKTOP_PET_ID,
    // read when Core assembles the Worlds, in the app language of that moment
    get label() { return petText(assembly.language?.()).console.label; },
    defaults: () => structuredClone(DESKTOP_PET_DEFAULTS),
    // ctx.cfg is the live `worlds.desktop-pet` section: hot keys are read at use
    create: (ctx) => {
      const world = new DesktopPetWorld({
        cfg: ctx.cfg,
        timezone: ctx.timezone,
        persist: (patch) => {
          ctx.persist(patch);
          // the whole look as it now is: a patch may carry only the part that changed
          if (patch.skin) assembly.onSkin?.(ctx.cfg.skin);
        },
        runtimesRoot,
        modelsDir: () => modelsDirFor(modelsRoot()),
        asrApiKey: () => ctx.secret(DESKTOP_PET_SECRETS.asrApiKey),
        storeAsrApiKey: (key) => ctx.storeSecret(DESKTOP_PET_SECRETS.asrApiKey, key),
        teamToken: () => ctx.secret(DESKTOP_PET_SECRETS.teamToken),
        storeTeamToken: (token) => ctx.storeSecret(DESKTOP_PET_SECRETS.teamToken, token),
        botName: () => assembly.botName?.() ?? ctx.botName,
        controls: assembly.controls,
        packRoots: () => [join(ctx.dataDir, 'figures'), ...assembly.packRoots?.() ?? []],
        packDir: () => join(ctx.dataDir, 'figures'),
        onBotChange: () => assembly.onBotChange?.(),
        onDesktopChange: (on) => assembly.onDesktopChange?.(on),
        describeTool: assembly.describeTool,
        modelLanguage: () => assembly.modelLanguage?.() ?? 'zh',
        replyLanguage: () => assembly.replyLanguage?.() ?? null,
        language: () => assembly.language?.() ?? 'zh',
        onCuaAnswer: (answer) => assembly.onCuaAnswer?.(answer),
      });
      assembly.onCreate?.(world);
      return world;
    },
    describe: DESCRIBE,
  };
}

export const DESKTOP_PET = desktopPetDefinition();
