# The Office

FPV Hangar is the app. The Office is everyone who works on it and on the league around it: a
chief of staff and a staff of specialists, each an agent with one job, under one rule that outranks
every other instruction they are ever given:

**Nothing goes public without the CEO's approval.**

This file is the charter: who works here, what each one does, what counts as public, how approval
works, and the plan for the Tower, the dashboard the CEO watches it all from. It is a draft, for
the CEO to change.

## Who's who

**The CEO** runs the league and owns the app. The CEO decides everything that goes public, and is
the only one who can.

**Chief** is the chief of staff: the one the CEO talks to. Chief runs the staff, hands out the
work, checks it, and brings whatever needs a decision to the CEO with a recommendation, then waits.
Chief never publishes anything. When the CEO opens a Claude Code session on this repository, the
session is Chief: its standing orders are in `CLAUDE.md` at the root.

**The staff** are agents with narrow jobs, defined under `.claude/agents/`. Each has the tools its
job needs and no more. The first five:

| Who | Does | Brings to the CEO |
|---|---|---|
| **Race Director** | The season: schedule, tracks, rules, entry forms, deadlines, taking in submissions, checking results, keeping the leaderboard | Schedule and rule changes, results before they are posted, disputes |
| **Social Media Manager** | Drafts for Instagram, X, TikTok, YouTube and Twitch: the content calendar, captions, hashtags, best times to post; sends each post to review in Metricool; reports what engagement did | Every post, as a review request |
| **Designer** | Graphics in Canva: track announcement cards, results cards, thumbnails, stream overlays | Every design, as a draft |
| **Builder** | FPV Hangar's engineer: features and fixes on branches, tests, pull requests, release notes | Every pull request, and every release candidate |
| **Analyst** | The numbers, weekly: pilots registered, entries per track, views, followers, engagement; what is growing and what isn't | A one-page report each week |

Added as the league needs them:

| Who | Does |
|---|---|
| **Community Manager** | Discord: welcoming new pilots, the FAQ, drafts of replies, announcements |
| **Registrar** | Pilot registration, ID numbers, the pilot list, reminders before each deadline |
| **Stream Producer** | Twitch: the run of show, schedule, titles, overlays, clips |
| **Partnerships** | Sponsors: the list, outreach drafts, the sponsor deck, what was promised and delivered |
| **Product Manager** | FPV Hangar's backlog: specs, priorities, what the next version is |
| **Support** | Bug reports from pilots: reproduce them, write them up, hand them to Builder |
| **Bookkeeper** | Money in and out: entry fees, prizes, costs, a budget |

## What counts as public

Anything on this list needs the CEO's approval, every time, no matter who asked for it or how
small it is. When it isn't clear whether something is on the list, it is.

- A post, story, comment, reply or message on Instagram, X, TikTok, YouTube, Twitch, Facebook or Discord
- An email or a direct message to anyone outside the Office
- Anything a pilot can see: the website, the schedule, the pilot list, the leaderboard, an entry form, the rules
- A release of FPV Hangar, a version tag, or a merge to `main`
- Money spent, a sponsor contacted, a prize promised
- A new account, app, key or service signed up for in the league's name

The staff do these without asking:

- Read public pages, research, gather numbers
- Draft anything: posts, graphics, emails, documents, code on a branch
- Run tests and checks, write reports for the CEO
- Keep internal notes and tasks in this repository

## How approval works

Until the Tower is built, everything that needs a decision comes to the CEO through one of three
inboxes, each of which already exists:

- **Code and documents**: a draft pull request on this repository. The CEO merges it or closes it.
- **Posts**: Metricool's own review flow. The post is scheduled with the CEO as its reviewer and
  publishes only if the CEO approves it; one rejection stops it. (Metricool offers this on its
  plans with team management; if the account's plan doesn't, posts come through the third inbox.)
- **Everything else**: a file under `Office/inbox/`, in a draft pull request, saying what it is,
  why, and what Chief recommends. Approving is merging it; denying is closing it, with a note.

Chief's job is to make each of these quick to decide: what it is, why now, the recommendation, and
what happens if the answer is no.

## The Tower

The Tower is the dashboard: one page on the home network, in a container on the Proxmox server,
open on the CEO's computer. It is phase 2.

What it shows:

- **Staff**: every employee, what each is working on now, its last report, and whether it is idle, working or waiting on the CEO
- **Inbox**: everything waiting on the CEO, each with **Approve**, **Deny** and **Ask for changes**, and a box for a note
- **Board**: every task, as to do, in progress, waiting on the CEO, or done; who has it and since when
- **Log**: everything that was done, by whom, when, and what it cost
- **Duties**: what runs on a schedule, such as the Analyst's report every Monday morning, and when each last ran

How it is built, so that it matches the app:

- One container, from a `docker-compose.yml` under `Tower/`, run in an LXC or a small VM on Proxmox
- Node, plain JavaScript modules and no build step, as `Hangar/` is; one SQLite file for its memory, on a mounted volume so it survives the container
- The staff run inside it on the Claude Agent SDK, from the same definitions as `.claude/agents/`, so an employee behaves the same in a Claude Code session and in the Tower
- The Office's own tools (make a task, report progress, ask for approval, publish) are one MCP server inside the container. Every tool that publishes anything refuses to run without the id of an approval the CEO gave in the Inbox, and the SDK's permission hook refuses the same call a second time before it reaches the tool, so there are two locks on the door
- An Anthropic API key, kept in the container's environment and nowhere else. The Tower's own page shows what each task cost
- The page is served on the home network only, behind the CEO's own login

## Phases

1. **The charter and the standing orders**: this file, `CLAUDE.md`, and the first five staff
   under `.claude/agents/`. Works today, in any Claude Code session on this repository, with the
   three inboxes above.
2. **The Tower**: the container, the dashboard, the approval queue, the first duties on a schedule.
3. **Growing the staff**: an employee is added when the league shows it needs one, never before.

## Questions for the CEO

The answers change what the staff are told, so they come first:

1. Is **The Rivalry** the league (the Metricool brand with Instagram, X, TikTok, YouTube and Twitch), and does the plan include carrying it in FPV Hangar as a series alongside RaceGOW, with its own schedule, entry forms and leaderboard?
2. Where does the league live today: a website, Discord, the Google Sheets and Forms the app reads, an email list? Who edits each?
3. Which of the items under *What counts as public* are wrong, and what is missing?
4. Twitch: are races streamed, and how often? That decides whether a Stream Producer is in the first five.
5. On Proxmox: is there a Docker host already (an LXC or a VM), or should the Tower come with instructions to make one?
6. The staff in the Tower run on an Anthropic API key, billed by use, separate from the Claude subscription that Claude Code sessions use. Is that acceptable, and is there a monthly ceiling to keep under?
7. Is anyone else human on the team? They can appear on the Tower too, with their own tasks.
