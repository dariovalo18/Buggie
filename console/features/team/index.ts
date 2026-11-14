/**
 * 「团队」: the team server (team-server/ in this repository) through the desktop-pet World's pet panel, whose
 * `team*` methods sign in, keep the token as a secret and call the server (src/team.ts). In sections: the account
 * (the server's address, the switch, sign-in or registration), the company (pick, create, join; the invite code for
 * admins), its members, work groups and projects (managed by owners and admins), and the tickets.
 *
 * Every call answers with the whole team state, which the page draws again; a failed one carries the server's error
 * code, shown beside the control that sent it.
 */

import { actionProblem } from '../../base/ui/problem.ts';
import { invokePanel } from '../../base/api.ts';
import type { Page, PageContext } from '../../base/page.ts';
import { intro } from '../intro.ts';
import { S, fill } from './strings.ts';

const PET_PAGE = 'world:desktop-pet';

interface Person { username: string; name: string }
interface OrgView {
  org: { id: number; name: string; role: string; invite?: string };
  members: Array<Person & { role: string }>;
  sectors: Array<{ id: number; name: string; members: Person[] }>;
  projects: Array<{ key: string; name: string; repos: string[]; archived: boolean; sectors: string[]; members: Person[] }>;
}
interface TeamState {
  enabled: boolean;
  url: string;
  org: number | null;
  signedIn: boolean;
  user: Person | null;
  orgs: Array<{ id: number; name: string; role: string }>;
  view: OrgView | null;
  problem: string | null;
  error?: string | null;
}
interface Ticket {
  ref: string; title: string; status: string; priority: string; sector: string | null; assignee: Person | null;
}

const errorText = (code: string) => (S.errors as Record<string, string>)[code] ?? code;

async function mount(ctx: PageContext): Promise<void> {
  const { ui, root, signal } = ctx;
  const opts = { signal };
  const problem = actionProblem(ui, root.ownerDocument, signal);
  root.classList.add('home');
  root.append(intro(ui, S.nav));

  const row = (label: string, control: HTMLElement, hint?: string) => {
    const r = ui.h('div', 'companion-row');
    const c = ui.h('div', 'companion-control');
    c.append(control);
    if (hint) c.append(ui.h('p', 'home-note', hint));
    r.append(ui.h('div', 'companion-label', label), c);
    return r;
  };
  const box = (...els: HTMLElement[]) => { const b = ui.h('div', 'companion-rangebox'); b.append(...els); return b; };
  const field = (placeholder: string, type: 'text' | 'password' = 'text') => { const i = ui.input({ type }); i.placeholder = placeholder; return i; };

  let state: TeamState | null = null;
  /** Calls a `team*` method; the state it answers with is drawn, its error shown at `anchor`. */
  async function call(method: string, args: unknown[], anchor: HTMLElement): Promise<boolean> {
    try {
      const next = await invokePanel<TeamState>(PET_PAGE, 'pet', method, args, opts);
      draw(next);
      if (next.error) { problem(anchor, errorText(next.error)); return false; }
      return true;
    } catch (err) {
      if (!signal.aborted) problem(anchor, fill(S.failed, { why: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  }
  const org = (verb: string, rest: string, body: unknown, anchor: HTMLElement) => call('teamOrg', [verb, rest, body ?? null], anchor);

  /* ---------- account ---------- */
  const account = ui.sheet({ title: S.accountTitle });
  const url = ui.input();
  url.addEventListener('change', () => void call('teamSetup', [{ url: url.value.trim() }], url));
  const enabled = ui.checkbox(S.connect, { onChange: (on) => void call('teamSetup', [{ enabled: on }], enabled.el) });
  const serverBox = ui.h('div', 'companion-switchbox');
  serverBox.append(enabled.el, url);
  const status = ui.msgline('');
  const username = field(S.username), password = field(S.password, 'password'), name = field(S.displayName);
  const signIn = ui.button(S.signIn, { variant: 'primary' });
  const register = ui.button(S.register);
  const signOut = ui.button(S.signOut, { size: 'sm' });
  const credentials = (reg: boolean) => ({ username: username.value.trim(), password: password.value, name: name.value.trim() || undefined, register: reg });
  signIn.addEventListener('click', async () => { if (await call('teamSignIn', [credentials(false)], signIn)) password.value = ''; }, { signal });
  register.addEventListener('click', async () => { if (await call('teamSignIn', [credentials(true)], register)) password.value = ''; }, { signal });
  password.addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn.click(); }, { signal });
  signOut.addEventListener('click', () => void call('teamSignOut', [], signOut), { signal });
  // the fields on one line and the buttons on the next: together they wrap in the longer languages
  const signInBox = ui.h('div', 'companion-switchbox');
  signInBox.append(box(username, password, name), box(signIn, register));
  const signedBox = box(status, signOut);
  const accountBox = ui.h('div');
  accountBox.append(signInBox, signedBox);
  account.body.append(row(S.serverLabel, serverBox, S.serverHint), row(S.accountLabel, accountBox, S.accountHint));
  root.append(account.el);

  /* ---------- company ---------- */
  const company = ui.sheet({ title: S.orgTitle });
  const orgPick = ui.select();
  orgPick.addEventListener('change', () => void call('teamUseOrg', [orgPick.value ? Number(orgPick.value) : null], orgPick), { signal });
  const orgName = field(S.newOrg);
  const createOrg = ui.button(S.create, { onClick: () => { if (orgName.value.trim()) void call('teamCreateOrg', [orgName.value.trim()], createOrg).then((ok) => { if (ok) orgName.value = ''; }); } });
  const inviteIn = field(S.inviteLabel);
  const join = ui.button(S.join, { onClick: () => { if (inviteIn.value.trim()) void call('teamJoinOrg', [inviteIn.value.trim()], join).then((ok) => { if (ok) inviteIn.value = ''; }); } });
  const invite = ui.input();
  invite.readOnly = true;
  const newInvite = ui.button(S.newInvite, { size: 'sm', onClick: () => void org('POST', '/invite', null, newInvite) });
  const inviteRow = row(S.inviteLabel, box(invite, ui.copyButton(() => invite.value), newInvite), S.inviteHint);
  company.body.append(row(S.orgLabel, orgPick), row(S.newOrgLabel, box(orgName, createOrg)), row(S.joinLabel, box(inviteIn, join)), inviteRow);
  root.append(company.el);

  /* ---------- members, work groups, projects ---------- */
  const people = ui.sheet({ title: S.membersTitle });
  const members = ui.table({ head: [S.colUser, S.colName, S.colRole, S.colSectors] });
  const newMember = field(S.username);
  const newRole = ui.select({ options: (['member', 'admin', 'owner'] as const).map((r) => ({ value: r, label: S.roles[r] })) });
  const addMember = ui.button(S.add, { onClick: () => { if (newMember.value.trim()) void org('POST', '/members', { username: newMember.value.trim(), role: newRole.value }, addMember).then((ok) => { if (ok) newMember.value = ''; }); } });
  const addMemberRow = row(S.addMemberLabel, box(newMember, newRole, addMember), S.addMemberHint);
  people.body.append(members.el, addMemberRow);
  root.append(people.el);

  const groups = ui.sheet({ title: S.sectorsTitle });
  const sectorTable = ui.table({ head: [S.colSector, S.colMembers] });
  const sectorName = field(S.newSector);
  const createSector = ui.button(S.create, { onClick: () => { if (sectorName.value.trim()) void org('POST', '/sectors', { name: sectorName.value.trim() }, createSector).then((ok) => { if (ok) sectorName.value = ''; }); } });
  const sectorMember = ui.select(), sectorPick = ui.select();
  const addToSector = ui.button(S.add, { onClick: () => { if (sectorMember.value && sectorPick.value) void org('PUT', `/sectors/${sectorPick.value}/members/${encodeURIComponent(sectorMember.value)}`, null, addToSector); } });
  const sectorAdmin = [row(S.newSectorLabel, box(sectorName, createSector)), row(S.addToSectorLabel, box(sectorMember, sectorPick, addToSector))];
  groups.body.append(sectorTable.el, ...sectorAdmin);
  root.append(groups.el);

  const projects = ui.sheet({ title: S.projectsTitle });
  const projectTable = ui.table({ head: [S.colKey, S.colProject, S.colRepos, S.colSectors, S.colMembers] });
  const projectKey = field(S.projectKey), projectName = field(S.projectName), projectRepos = field(S.projectRepos);
  projectKey.maxLength = 10;
  const createProject = ui.button(S.create, {
    onClick: () => {
      if (!projectKey.value.trim() || !projectName.value.trim()) return;
      const repos = projectRepos.value.split(',').map((r) => r.trim()).filter(Boolean);
      void org('POST', '/projects', { key: projectKey.value.trim(), name: projectName.value.trim(), repos }, createProject)
        .then((ok) => { if (ok) projectKey.value = projectName.value = projectRepos.value = ''; });
    },
  });
  const projectMember = ui.select(), projectPick = ui.select();
  const addToProject = ui.button(S.add, { onClick: () => { if (projectMember.value && projectPick.value) void org('PUT', `/projects/${projectPick.value}/members/${encodeURIComponent(projectMember.value)}`, null, addToProject); } });
  const projectSector = ui.select();
  const linkSector = ui.button(S.add, {
    onClick: () => {
      const p = state?.view?.projects.find((x) => x.key === projectPick.value);
      if (p && projectSector.value) void org('PATCH', `/projects/${p.key}`, { sectors: [...new Set([...p.sectors, projectSector.value])] }, linkSector);
    },
  });
  const projectAdmin = [
    row(S.newProjectLabel, box(projectKey, projectName, projectRepos, createProject), S.projectHint),
    row(S.addToProjectLabel, box(projectMember, projectPick, addToProject)),
    row(S.projectSectorLabel, box(projectSector, linkSector)),
  ];
  projects.body.append(projectTable.el, ...projectAdmin);
  root.append(projects.el);

  /* ---------- tickets ---------- */
  const tickets = ui.sheet({ title: S.ticketsTitle });
  const filter = ui.select({ options: [{ value: 'assignee=me', label: S.filterMine }, { value: '', label: S.filterActive }, { value: 'status=all', label: S.filterAll }] });
  filter.addEventListener('change', () => void loadTickets(), { signal });
  const refresh = ui.button(S.refresh, { size: 'sm', onClick: () => void loadTickets() });
  const ticketTable = ui.table({ head: [S.colRef, S.colTitle, S.colStatus, S.colPriority, S.colSector, S.colAssignee] });
  tickets.body.append(box(filter, refresh), ticketTable.el, ui.h('p', 'home-note', S.ticketsHint));
  root.append(tickets.el);

  async function loadTickets(): Promise<void> {
    if (!state?.view) return;
    const r = await invokePanel<{ tickets: Ticket[]; error?: string }>(PET_PAGE, 'pet', 'teamTickets', [filter.value], opts).catch(() => null);
    if (signal.aborted) return;
    ticketTable.clear();
    if (!r || r.error) { ticketTable.clear(errorText(r?.error ?? 'unreachable')); return; }
    if (!r.tickets.length) { ticketTable.clear(S.noTickets); return; }
    for (const t of r.tickets) {
      ticketTable.addRow([t.ref, t.title, (S.statuses as Record<string, string>)[t.status] ?? t.status, (S.priorities as Record<string, string>)[t.priority] ?? t.priority, t.sector ?? '—', t.assignee?.name ?? '—']);
    }
  }

  /* ---------- drawing ---------- */
  const options = (select: HTMLSelectElement, items: Array<{ value: string; label: string }>) => {
    const was = select.value;
    select.replaceChildren(...items.map((i) => { const o = root.ownerDocument.createElement('option'); o.value = i.value; o.textContent = i.label; return o; }));
    if (items.some((i) => i.value === was)) select.value = was;
  };
  const names = (list: Person[]) => list.map((p) => p.name).join(', ') || '—';

  function draw(next: TeamState): void {
    if (signal.aborted) return;
    const hadView = state?.view?.org.id;
    state = next;
    if (root.ownerDocument.activeElement !== url) url.value = next.url;
    enabled.setChecked(next.enabled);
    signInBox.hidden = next.signedIn;
    signedBox.hidden = !next.signedIn;
    status.textContent = next.user ? fill(S.signedIn, { name: next.user.name, user: next.user.username }) : S.signedOut;
    status.classList.toggle('bad', !!next.problem);
    if (next.problem && next.signedIn) status.textContent += ` · ${errorText(next.problem)}`;
    const view = next.view;
    company.el.hidden = !next.signedIn;
    options(orgPick, [{ value: '', label: S.noOrg }, ...next.orgs.map((o) => ({ value: String(o.id), label: `${o.name} · ${S.roles[o.role as keyof typeof S.roles] ?? o.role}` }))]);
    orgPick.value = next.org !== null && next.orgs.some((o) => o.id === next.org) ? String(next.org) : '';
    const admin = view !== null && view.org.role !== 'member';
    inviteRow.hidden = !admin;
    invite.value = view?.org.invite ?? '';
    for (const sheet of [people, groups, projects, tickets]) sheet.el.hidden = !view;
    addMemberRow.hidden = !admin;
    for (const r of [...sectorAdmin, ...projectAdmin]) r.hidden = !admin;
    if (!view) return;
    members.clear();
    for (const m of view.members) {
      const groupsOf = view.sectors.filter((s) => s.members.some((x) => x.username === m.username)).map((s) => s.name).join(', ') || '—';
      members.addRow([m.username, m.name, S.roles[m.role as keyof typeof S.roles] ?? m.role, groupsOf]);
    }
    sectorTable.clear(view.sectors.length ? undefined : S.noSectors);
    for (const s of view.sectors) sectorTable.addRow([s.name, names(s.members)]);
    projectTable.clear(view.projects.length ? undefined : S.noProjects);
    for (const p of view.projects) projectTable.addRow([p.key, p.name, p.repos.join(', ') || '—', p.sectors.join(', ') || '—', names(p.members)]);
    const memberItems = view.members.map((m) => ({ value: m.username, label: `${m.name} (${m.username})` }));
    options(sectorMember, memberItems);
    options(projectMember, memberItems);
    options(sectorPick, view.sectors.map((s) => ({ value: String(s.id), label: s.name })));
    options(projectSector, view.sectors.map((s) => ({ value: s.name, label: s.name })));
    options(projectPick, view.projects.map((p) => ({ value: p.key, label: `${p.key} · ${p.name}` })));
    if (hadView !== view.org.id) void loadTickets();
  }

  const first = await invokePanel<TeamState>(PET_PAGE, 'pet', 'teamState', [], opts).catch(() => null);
  if (first) draw(first);
}

export const teamPage: Page = {
  route: 'team',
  label: S.nav,
  icon: 'globe',
  mount,
};
