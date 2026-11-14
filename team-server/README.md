# Buggie team server (`hub.ts`, `server.ts`)

Accounts, companies (orgs), their work groups (sectors), projects and tickets, shared by the Buggies of one team. One file of logic (`hub.ts`), Node's built-in SQLite, no dependencies; Node 24 or later runs the TypeScript as it is.

## Run

Locally, from the repository root:

```bash
pnpm run team-server          # http://127.0.0.1:8791, data in team-data/team.sqlite
```

On a server:

```bash
mkdir -p data && chown 1000:1000 data
docker compose up -d --build
```

The published image is `ddblack6/buggie-team-server` on Docker Hub, usable without the repository:

```bash
docker run -d --restart unless-stopped -p 127.0.0.1:8791:8791 -v buggie-team:/data -e TRUST_PROXY=1 ddblack6/buggie-team-server:latest
```

It is built by `.github/workflows/team-server-image.yml` for amd64 and arm64: pushing a tag `team-server-v1.2.3` publishes `1.2.3`, `1.2` and `latest`. The workflow needs the repository secret `DOCKERHUB_TOKEN`, a Docker Hub access token with read and write rights. By hand: `docker build -t ddblack6/buggie-team-server:1.2.3 team-server` and `docker push ddblack6/buggie-team-server:1.2.3`.

The container listens on `127.0.0.1:8791`; put an HTTPS reverse proxy in front. The compose file sets `TRUST_PROXY=1`: the client address is the last `X-Forwarded-For` entry, the one the proxy writes, so the proxy must set that header. Back up `data/team.sqlite` with `sqlite3 data/team.sqlite ".backup backup.sqlite"` while it runs.

Passwords are stored as scrypt hashes and tokens as SHA-256 hashes. Ten failed sign-ins in a row lock an account's sign-in for five minutes; each client address may register, sign in, change a password or try an invite code 30 times in ten minutes. Both counts are kept in memory. Every org sees only its own members, sectors, projects and tickets: a request for another org answers 404.

## API

JSON in and out. Every route except `health`, `register` and `login` takes `Authorization: Bearer <token>`. An error is `{ "error": "<code>" }` with a 4xx status; an org the account is not in answers 404.

| Route | Who | Does |
|---|---|---|
| `POST /v1/register` `{username, password, name?, label?}` | anyone | creates the account and signs in: `{token, user, orgs}` |
| `POST /v1/login` `{username, password, label?}` | anyone | a new token for this device |
| `POST /v1/logout` | signed in | ends this token |
| `GET /v1/me`, `PATCH /v1/me` `{name}` | signed in | the account and its orgs |
| `POST /v1/me/password` `{current, password}` | signed in | a new password; every other token of the account ends |
| `POST /v1/orgs` `{name}` | signed in | a new org, owned by the caller |
| `POST /v1/orgs/join` `{invite}` | signed in | joins by invite code, as a member |
| `GET /v1/orgs/:org` | member | members, sectors and projects with their members; the invite code for admins |
| `DELETE /v1/orgs/:org` `{name}` | owner | deletes the org and everything in it; `name` must be the org's |
| `POST /v1/orgs/:org/invite` | admin | replaces the invite code |
| `POST /v1/orgs/:org/members` `{username, role?}` | admin | adds an account |
| `PATCH`/`DELETE /v1/orgs/:org/members/:username` | admin; anyone for themselves | changes a role, removes a member |
| `POST /v1/orgs/:org/sectors` `{name}`, `PATCH`/`DELETE …/sectors/:id` | admin | work groups |
| `PUT`/`DELETE …/sectors/:id/members/:username` | admin | who is in a sector |
| `POST /v1/orgs/:org/projects` `{key, name, repos?, sectors?}`, `PATCH …/projects/:key` `{name?, repos?, sectors?, archived?}` | admin | projects |
| `PUT`/`DELETE …/projects/:key/members/:username` | admin | who is in a project |
| `GET /v1/orgs/:org/tickets?project&sector&status&assignee&q&limit` | member | tickets, newest change first; `status` is a comma list or `active` (default, open and in progress) or `all`; `assignee` is a username, `me` or `none` |
| `POST /v1/orgs/:org/tickets` `{project, title, body?, sector?, priority?, assignee?, source?}` | member | a ticket numbered in its project (`PAY-12`) |
| `GET`/`PATCH /v1/orgs/:org/tickets/:ref` `{title?, body?, status?, priority?, sector?, assignee?}` | member | one ticket with its comments; a change |
| `POST /v1/orgs/:org/tickets/:ref/comments` `{body}` | member | a comment |
| `GET /v1/orgs/:org/changes?since&wait` | member | the activity log after sequence `since`; without `since`, only the current sequence. `wait` (seconds, up to 30) holds the answer until the next entry |

Roles are `owner`, `admin` and `member`. Only an owner makes or unmakes an owner, and an org always keeps one. Statuses are `open`, `in_progress`, `resolved` and `closed`; priorities `low`, `normal`, `high` and `urgent`. A project key is 2 to 10 capital letters and digits, starting with a letter.

The activity log records `ticket.created`, `ticket.updated` (with each changed field's `from` and `to`), `ticket.comment` (with an `excerpt`), `sector.member` and `project.member` (with the `member` added).
