/**
 * The team server's tools, given while the person is signed in with an org picked (`TeamClient.ready`).
 * Each answers with the server's JSON; a failure is the server's error code.
 */
import type { ToolDef, ToolOutcome } from 'cortico/core/types.ts';
import { TeamError, type TeamClient } from './team.ts';

const STATUS = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITY = ['low', 'normal', 'high', 'urgent'];
const ref = { type: 'string', description: 'The ticket reference, project key and number, e.g. PAY-12.' };

export const TEAM_TOOL_DECLS: Array<Omit<ToolDef, 'handler'>> = [
  {
    name: 'team_info',
    tags: ['read'],
    description: 'Read the team server: who you are signed in as, the org, its members with their roles, its work groups (sectors) with their members, and its projects with their keys, repositories, sectors and members.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ticket_list',
    tags: ['read'],
    description: 'List tickets on the team server, most recently changed first. By default the active ones (open and in progress) of every project.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'A project key.' },
        sector: { type: 'string', description: 'A work group name.' },
        status: { type: 'string', description: 'Statuses joined by commas, or active (default) or all.' },
        assignee: { type: 'string', description: 'A username, me, or none for unassigned tickets.' },
        query: { type: 'string', description: 'Text to find in titles and bodies.' },
      },
      required: [],
    },
  },
  {
    name: 'ticket_get',
    tags: ['read'],
    description: 'Read one ticket with its body, where it came from and its comments.',
    parameters: { type: 'object', properties: { ref }, required: ['ref'] },
  },
  {
    name: 'ticket_create',
    tags: ['act'],
    description: 'Open a ticket in a project of the team server. The answer carries its reference.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'The project key; team_info lists them with their repositories.' },
        title: { type: 'string', description: 'The problem or task, one line.' },
        body: { type: 'string', description: 'Details: what happens, what was expected, the error, how to reproduce. Markdown.' },
        sector: { type: 'string', description: 'The work group that should take it.' },
        priority: { type: 'string', enum: PRIORITY, description: 'Default normal.' },
        assignee: { type: 'string', description: 'A username, or me.' },
        source: {
          type: 'object',
          description: 'Where it came from, when it came from a bug: the command, folder, file and line.',
          properties: { command: { type: 'string' }, cwd: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' } },
        },
      },
      required: ['project', 'title'],
    },
  },
  {
    name: 'ticket_update',
    tags: ['act'],
    description: 'Change a ticket: its status, who has it, its work group, priority, title or body. Give only what changes.',
    parameters: {
      type: 'object',
      properties: {
        ref,
        status: { type: 'string', enum: STATUS },
        assignee: { type: 'string', description: 'A username, me, or an empty string to leave it unassigned.' },
        sector: { type: 'string', description: 'A work group name, or an empty string for none.' },
        priority: { type: 'string', enum: PRIORITY },
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'ticket_comment',
    tags: ['act'],
    description: 'Add a comment to a ticket, signed with the person\'s account.',
    parameters: { type: 'object', properties: { ref, body: { type: 'string', description: 'Markdown.' } }, required: ['ref', 'body'] },
  },
];

type Args = Record<string, unknown>;
const enc = encodeURIComponent;

/** The handlers, by tool name, over `team`; `me` in an assignee is the signed-in account. */
export function teamHandlers(team: TeamClient): Record<string, (args: Args) => Promise<ToolOutcome>> {
  const me = (v: unknown) => (v === 'me' ? team.user?.username ?? v : v);
  const run = async (f: () => Promise<unknown>): Promise<ToolOutcome> => {
    try {
      return { text: JSON.stringify(await f()) };
    } catch (e) {
      return { text: `team server: ${e instanceof TeamError ? e.code : String(e)}`, failed: true };
    }
  };
  return {
    team_info: () => run(async () => ({ you: team.user, ...await team.call('GET', team.orgPath()) })),
    ticket_list: (a) => run(() => {
      const q = new URLSearchParams();
      for (const [k, v] of [['project', a.project], ['sector', a.sector], ['status', a.status], ['assignee', a.assignee], ['q', a.query]] as const) {
        if (typeof v === 'string' && v) q.set(k, v);
      }
      return team.call('GET', team.orgPath(`/tickets?${q}`));
    }),
    ticket_get: (a) => run(() => team.call('GET', team.orgPath(`/tickets/${enc(String(a.ref))}`))),
    ticket_create: (a) => run(() => team.call('POST', team.orgPath('/tickets'), { ...a, assignee: me(a.assignee) })),
    ticket_update: (a) => run(() => {
      const { ref: r, ...fields } = a;
      if (fields.assignee !== undefined) fields.assignee = me(fields.assignee);
      return team.call('PATCH', team.orgPath(`/tickets/${enc(String(r))}`), fields);
    }),
    ticket_comment: (a) => run(() => team.call('POST', team.orgPath(`/tickets/${enc(String(a.ref))}/comments`), { body: a.body })),
  };
}
