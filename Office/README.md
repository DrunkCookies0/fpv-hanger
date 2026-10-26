# The Office

FPV Hangar is the app. The Office is everyone who works on it: a chief of staff and a staff of
specialists, each an agent with one job, under one rule that outranks every other instruction they
are ever given:

**Nothing goes public without the CEO's approval.**

This file is the charter: who works here, what each one does, what counts as public, how approval
works, and the plan for the Tower, the dashboard the CEO watches it all from. It is a draft, for
the CEO to change. It is about FPV Hangar only; anything else the CEO runs has an office of its
own, in a repository of its own.

## Who's who

**The CEO** owns FPV Hangar, decides everything that goes public, and is the only one who can.

**Chief** is the chief of staff: the one the CEO talks to. Chief runs the staff, hands out the
work, checks it, and brings whatever needs a decision to the CEO with a recommendation, then waits.
Chief never publishes anything. When the CEO opens a Claude Code session on this repository, the
session is Chief: its standing orders are in `CLAUDE.md` at the root.

**The staff** are agents with narrow jobs, defined under `.claude/agents/`. Each has the tools its
job needs and no more. The first five:

| Who | Does | Brings to the CEO |
|---|---|---|
| **Product Manager** | The backlog: what pilots ask for, what the next version is, a spec for each feature before it is built, the changelog entry when it is | The plan for each version |
| **Builder** | The engineer: features and fixes on branches, with tests, as `README.md` says the app is built | Every pull request |
| **Tester** | Runs the tests and the app's own self-test on every pull request, tries the packaged app, and writes the release notes | A release candidate, ready to publish, or what is wrong with it |
| **Support** | Bug reports and questions from pilots, wherever they arrive: reproduces them, writes them up, hands them to Builder, drafts the reply | Every reply, as a draft |
| **Analyst** | The numbers, weekly: downloads of each version, copies that updated, the series' public pilot count, what pilots use and what they don't | A one-page report each week |

Added as the app needs them:

| Who | Does |
|---|---|
| **Designer** | Icons, screenshots, the pictures in read-mes and release notes |
| **Writer** | The read-mes, How it works, the welcome and What's new notes |
| **Social Media Manager** | If the app gets channels of its own: drafts of every post, sent for review |
| **Watcher** | The things the app depends on: Electron, FFmpeg, EdgeTX, ExpressLRS, Betaflight, the series' sheets and pages. Says when one changes or breaks |

## What counts as public

Anything on this list needs the CEO's approval, every time, no matter who asked for it or how
small it is. When it isn't clear whether something is on the list, it is.

- A release of FPV Hangar, a version tag, a run of the Release workflow with Publish ticked, or a merge to `main`
- Anything a pilot can read: the repository's page, a release's notes, a read-me, an issue or a comment on GitHub
- A post, comment or reply anywhere on the web, under the app's name or the CEO's
- An email or a direct message to anyone outside the Office
- Money spent, a key or an account made in the app's name, a service signed up for

The staff do these without asking:

- Read public pages, research, gather numbers
- Draft anything: code on a branch, tests, notes, replies, pictures
- Run tests and checks, package the app to try it, write reports for the CEO
- Keep internal notes and tasks in this repository

## How approval works

Until the Tower is built, everything that needs a decision comes to the CEO through one of two
inboxes, both of which already exist:

- **Code and documents**: a draft pull request on this repository. The CEO merges it or closes it.
  A release is a pull request too, with `VERSION` and the changelog entry; the CEO merges it and
  presses Publish, as `README.md` says.
- **Everything else**: a file under `Office/inbox/`, in a draft pull request, saying what it is,
  why, and what Chief recommends. Approving is merging it; denying is closing it, with a note.

Chief's job is to make each of these quick to decide: what it is, why now, the recommendation, and
what happens if the answer is no.

## The Tower

The Tower is the dashboard: one page on the home network, in a container on the Proxmox server,
open on the CEO's computer. It is phase 2. It is built to watch more than one office, so another
venture's staff can appear on it from their own repository without sharing anything with this one.

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
- The Office's own tools (make a task, report progress, ask for approval, publish) are one MCP server inside the container. Every tool that publishes anything refuses to run without the id of an approval the CEO gave in the Inbox. Before a call even reaches the tool, the SDK's pre-tool hook looks for the same approval: without one it parks the call in the Inbox and ends the employee's turn, which picks up where it stopped once the CEO decides, and a denial carries the CEO's note back to the employee. Two locks on the door, and an approval can take a day without anything waiting on it
- An Anthropic API key, kept in the container's environment and nowhere else, billed by use. Anthropic's terms don't let a product built on the Agent SDK sign in with a Claude subscription, so the Tower can't share the one these Claude Code sessions run on. The Tower's own page shows what each task cost
- The SQLite file and the staff's sessions live on the mounted volume, so a restart of the container loses nothing, not even an approval half-way through; and the staff run as an ordinary user inside it, never as root
- The page is served on the home network only, behind the CEO's own login

## Phases

1. **The charter and the standing orders**: this file, `CLAUDE.md`, and the first five staff
   under `.claude/agents/`. Works today, in any Claude Code session on this repository, with the
   two inboxes above.
2. **The Tower**: the container, the dashboard, the approval queue, the first duties on a schedule.
3. **Growing the staff**: an employee is added when the app shows it needs one, never before.

## Questions for the CEO

The answers change what the staff are told, so they come first:

1. Are these the right first five, and is anything on *What counts as public* wrong or missing?
2. Where do pilots reach you about the app today: GitHub issues, a Discord, email, somewhere else? That is where Support listens.
3. What is next for the app? The read-me's "Coming soon" has a Video Creator for any footage; is that the next version, or is something else?
4. On Proxmox: is there a Docker host already (an LXC or a VM), or should the Tower come with instructions to make one?
5. The staff in the Tower run on an Anthropic API key, billed by use, separate from the Claude subscription that Claude Code sessions use. Is that acceptable, and is there a monthly ceiling to keep under?
6. Is anyone else human on the team? They can appear on the Tower too, with their own tasks.
