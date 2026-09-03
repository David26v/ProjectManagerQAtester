import { useEffect, useRef, useState } from 'react';
import { BookOpen, Lightbulb, AlertTriangle, Info, Bug } from 'lucide-react';
import { cn } from '@/lib/utils';

// `#/guide` — the operator's manual, built into the app so the QA never has
// to hunt for an external doc. Content mirrors docs/MANUAL.md; keep the two
// in sync when workflows change.

const SECTIONS = [
  { id: 'concepts', title: '1 · Tests, suites, runs' },
  { id: 'first-test', title: '2 · Make your first test' },
  { id: 'workspace', title: '3 · Workspace & members' },
  { id: 'running', title: '4 · Running tests' },
  { id: 'detection', title: '5 · How bugs get caught' },
  { id: 'triage', title: '6 · Reading results' },
  { id: 'reports', title: '7 · Reports & handoff' },
  { id: 'kanban', title: '8 · Kanban bug tracking' },
  { id: 'credentials', title: '9 · Testing behind a login' },
  { id: 'scheduling', title: '10 · Scheduling' },
  { id: 'repository', title: '11 · Repository (git)' },
  { id: 'steps', title: '12 · Step types' },
  { id: 'cli', title: '13 · CLI & automation' },
  { id: 'troubleshooting', title: '14 · Troubleshooting' },
];

const Callout = ({ tone = 'info', icon: Icon = Info, children }) => {
  const tones = {
    info: 'bg-accent text-foreground',
    tip: 'bg-warning-bg text-foreground',
    danger: 'bg-danger-bg text-foreground',
    success: 'bg-success-bg text-foreground',
  };
  const iconTones = { info: 'text-primary', tip: 'text-warning', danger: 'text-danger', success: 'text-success' };
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm', tones[tone])}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconTones[tone])} />
      <div className="min-w-0">{children}</div>
    </div>
  );
};

const Section = ({ id, title, children }) => (
  <section id={`guide-${id}`} className="scroll-mt-4">
    <h2 className="text-lg font-semibold text-foreground">{title}</h2>
    <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-foreground">{children}</div>
  </section>
);

const Steps = ({ items }) => (
  <ol className="flex flex-col gap-2.5">
    {items.map((item, i) => (
      <li key={i} className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold tabular-nums text-primary">
          {i + 1}
        </span>
        <span className="min-w-0">{item}</span>
      </li>
    ))}
  </ol>
);

const Bullets = ({ items }) => (
  <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-primary">
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

const Mono = ({ children }) => <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{children}</code>;

const GuideTable = ({ head, rows }) => (
  <div className="overflow-x-auto rounded-lg border border-border">
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border bg-secondary/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {head.map((h) => (
            <th key={h} className="px-3 py-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border last:border-0">
            {row.map((cell, j) => (
              <td key={j} className={cn('px-3 py-2 align-top', j === 0 && 'whitespace-nowrap font-medium text-foreground')}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const Guide = () => {
  const [active, setActive] = useState(SECTIONS[0].id);
  const contentRef = useRef(null);

  // Scrollspy — highlight the TOC entry for the section nearest the top of
  // the scrolling <main>. Cheap manual version (no IntersectionObserver
  // bookkeeping): on scroll, pick the last section whose top passed.
  useEffect(() => {
    const scroller = contentRef.current?.closest('main');
    if (!scroller) return undefined;
    const onScroll = () => {
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(`guide-${s.id}`);
        if (el && el.getBoundingClientRect().top < 140) current = s.id;
      }
      setActive(current);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  const jump = (id) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div ref={contentRef} className="flex gap-8 p-8">
      <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-10">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">Guide</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            The operator's manual, built in — how to make tests, run them, catch bugs, and hand them to a developer.
          </p>
        </div>

        <Section id="concepts" title="1 · Tests, suites, and runs">
          <p>
            A <strong>test</strong> here is a <strong>suite</strong>: a browser flow you recorded once — clicks, typing, navigation — saved as editable
            steps that end in an assertion. A <strong>run</strong> is one execution of a suite in a real automated browser.
          </p>
          <Bullets
            items={[
              <>
                <strong>Suites are reusable</strong> — record "Login" once, run it after every deploy forever.
              </>,
              <>
                <strong>Runs carry evidence</strong> — each run keeps its own video, screenshots, and error logs, so Tuesday's failure survives
                Wednesday's pass.
              </>,
              <>
                <strong>Suites group steps into one flow</strong> with a single pass/fail verdict.
              </>,
              <>
                <strong>Suites can be targeted</strong> — tag one <Mono>smoke</Mono> to gate deploys; point the same suite at Staging or Production.
              </>,
            ]}
          />
          <p>
            The chain: a <strong>Project</strong> has <strong>Suites</strong>, suites produce <strong>Runs</strong>, runs become{' '}
            <strong>Reports</strong>, reports become <strong>Tickets</strong> on the Kanban board. Everything is shared live with your workspace.
          </p>
        </Section>

        <Section id="first-test" title="2 · Make your first test">
          <Steps
            items={[
              <>
                Open <strong>Recorder</strong> in the sidebar.
              </>,
              <>
                Enter the <strong>starting URL</strong>, pick the <strong>project</strong>, and — if the flow needs a login — a{' '}
                <strong>credential profile</strong> (§9) so recording starts signed in.
              </>,
              <>
                Click <strong>Start Recording</strong>. A real Chrome window opens — use the site like a real user. Every action appears live in the
                Steps list; delete stray clicks from a step's menu. Passwords are masked, never stored.
              </>,
              <>
                Click <strong>Stop</strong>, then <strong>Save Suite</strong> — name it after the flow ("Login works"), pick an environment, add tags (
                <Mono>smoke</Mono> to run after deploys).
              </>,
              <>
                Open the saved suite and <strong>make sure the last step asserts something</strong> — e.g. <Mono>assertVisible</Mono> on the success
                screen's heading. Steps can be renamed, reordered, edited, or deleted in Suite Detail.
              </>,
            ]}
          />
          <Callout tone="tip" icon={Lightbulb}>
            One flow per suite (small suites fail precisely) · start at the flow's real URL · <strong>end with an assertion</strong> — the assertion is
            the bug detector · tag deploy-gating suites <Mono>smoke</Mono>.
          </Callout>
        </Section>

        <Section id="workspace" title="3 · Workspace & members">
          <p>
            Everything here belongs to your <strong>workspace</strong> — your company's own, isolated space. You're a member of exactly one at a time;
            nothing you see is visible to any other company's workspace.
          </p>
          <GuideTable
            head={['Role', 'Can do']}
            rows={[
              ['Member', 'All QA work — record, run, report, tickets, credentials, schedules, repository'],
              ['Admin', 'Everything a Member can, plus invite/remove members, change roles, and delete projects'],
              ['Owner', 'Everything an Admin can, plus rename or delete the whole workspace'],
            ]}
          />
          <p>Only an owner can change or remove another owner.</p>
          <Bullets
            items={[
              <>
                <strong>Inviting a teammate</strong> — an owner or admin opens <strong>Workspace</strong> in the sidebar and invites by email. A
                brand-new email gets a login on the spot and a <strong>one-time temporary password</strong> shown once in a dialog — hand it over
                yourself; it's never stored or logged. An email that already has an account just gains membership and signs in with its existing
                password.
              </>,
              <>
                <strong>Plan limits</strong> — exceeding your plan's member or project limit is refused with a message to contact KriJax Software and
                Development to upgrade.
              </>,
            ]}
          />
          <Callout tone="info">
            No workspace yet ("You're not in a workspace yet") or a suspended workspace ("This workspace is suspended") both replace the whole app
            with a message and a <strong>Sign out</strong> button — ask whoever manages your team's account, or contact KriJax Software and
            Development.
          </Callout>
        </Section>

        <Section id="running" title="4 · Running tests">
          <Steps
            items={[
              <>
                Click <strong>Run</strong> on any suite. The Run Suite dialog opens: pick <strong>environment</strong>,{' '}
                <strong>headless</strong> (invisible, default) or <strong>headed</strong> (watch live), optional <strong>retries</strong>, optional{' '}
                <strong>credential profile</strong>.
              </>,
              <>A live progress banner tracks each step wherever you navigate.</>,
              <>
                On finish, the <strong>completion dialog</strong> shows the verdict, step tally, and error counts — with View Details and (on failure)
                Build Report.
              </>,
            ]}
          />
          <p>
            Every run automatically captures: a <strong>full video</strong>, a <strong>screenshot at the failing step</strong>, all{' '}
            <strong>console errors</strong> and <strong>uncaught page exceptions</strong>, every <strong>failed network request</strong>, and every{' '}
            <strong>HTTP 4xx/5xx response</strong> — even on runs that pass.
          </p>
        </Section>

        <Section id="detection" title="5 · How bugs actually get caught">
          <p>
            The tool detects <em>deviations from what you recorded</em> plus <em>every error signal the browser emits</em> — four layers, all active on
            every run:
          </p>
          <Bullets
            items={[
              <>
                <strong>Assertions fail.</strong> Your recorded expectations are the contract — login not reaching the dashboard turns the run red.
              </>,
              <>
                <strong>Steps fail.</strong> Vanished buttons, dead pages, renamed fields break the replay itself (selector timeout).
              </>,
              <>
                <strong>Errors are captured even on green runs.</strong> Console errors, uncaught exceptions, failed requests, 4xx/5xx — this surfaces
                "silent" bugs where the page looks fine but an API failed behind it. Check the Console/Network tabs even on passes.
              </>,
              <>
                <strong>Evidence for your eyes.</strong> Video and screenshots catch visual bugs automation can't judge — the verdict there is yours.
              </>,
            ]}
          />
          <p>
            Because suites re-run on demand, on schedules, and after deploys, the biggest catch is <strong>regressions</strong> — things that worked
            last week and quietly broke. The machine flags the deviation; you decide in triage whether it's a real bug or a test needing an update.
          </p>
        </Section>

        <Section id="triage" title="6 · Reading results (triage order)">
          <Steps
            items={[
              <>
                <strong>The failing step + its error.</strong> Selector timeout usually = UI changed (test problem); assertion mismatch usually = app
                changed (possible bug).
              </>,
              <>
                <strong>The failure screenshot</strong> — what the page actually looked like.
              </>,
              <>
                <strong>The video</strong> — scrub to just before the failure.
              </>,
              <>
                <strong>Console Logs tab</strong> — root causes often live here (e.g. the page looked empty because an API returned 500).
              </>,
              <>
                <strong>Network Failures tab</strong> — requests that never completed.
              </>,
            ]}
          />
          <Callout tone="info">
            <strong>Open Folder</strong> opens a local run's folder on disk; for cloud runs (the normal case) it copies a one-hour{' '}
            <strong>signed video link</strong> to your clipboard — paste it straight into chat.
          </Callout>
        </Section>

        <Section id="reports" title="7 · Reports & bug handoff">
          <Steps
            items={[
              <>
                From a failed run, click <strong>Build Report</strong>.
              </>,
              <>
                <strong>Select evidence</strong> in the media grid; click a thumbnail for the Evidence Preview (zoom + notes). Selections save
                automatically.
              </>,
              <>Fill title, description, severity, and the editable reproduction steps — the Live Preview updates as you type.</>,
              <>
                <strong>Generate</strong>: Kanban Ticket (bug card linked to the run) · Excel (screenshots embedded) · JSON · Zip Bundle ("Send to
                David") — any combination.
              </>,
            ]}
          />
          <Callout tone="danger" icon={Bug}>
            <strong>Fastest handoff:</strong> Build Report → tick the failure screenshot + video → <strong>Create Kanban Ticket</strong> → drag it to{' '}
            <em>Ready for QA</em>. The developer opens the ticket and watches the video themselves. All tracking lives on the built-in board.
          </Callout>
          <p>
            The <strong>Reports</strong> screen lists every run with report work started — reopen the builder or export Excel/JSON/zip directly from
            the row.
          </p>
        </Section>

        <Section id="kanban" title="8 · Kanban bug tracking">
          <Bullets
            items={[
              <>
                Five columns — <strong>Backlog / Ready for QA / In Progress / Blocked / Done</strong> — drag cards to change status.
              </>,
              <>Filter by project, severity, assignee, or search; the right rail shows aging and weekly throughput.</>,
              <>
                <strong>+ Add Ticket</strong> per column for bugs found outside a run.
              </>,
              <>
                Ticket detail: description, repro steps, evidence from the linked run, console/network diagnostics, comments (attributed to your
                account), and a QA checklist.
              </>,
            ]}
          />
        </Section>

        <Section id="credentials" title="9 · Testing behind a login">
          <p>
            Never type real passwords while recording — store the login once as a <strong>credential profile</strong>, then pick it in the Recorder or
            Run dialog.
          </p>
          <Steps
            items={[
              <>
                <strong>Session Capture</strong> (recommended): Credentials → New Profile → fill name/project/login URL → <strong>Capture Session</strong>{' '}
                — a real browser opens; log in yourself, then click <em>I've logged in — capture</em>. The browser session (not the password) is stored,
                encrypted with your OS keychain.
              </>,
              <>
                <strong>Manual Entry</strong>: store a username + password instead — encrypted on this device only, never shown again.
              </>,
            ]}
          />
          <Callout tone="info">
            Profiles are listed workspace-wide, but the <strong>secret only exists on the machine that captured it</strong> — on another machine,
            capture the session again there.
          </Callout>
        </Section>

        <Section id="scheduling" title="10 · Scheduling">
          <Steps
            items={[
              <>
                Run Suite dialog → <strong>Schedule</strong> tab → date, time, and Once / Daily / Weekly → <strong>Schedule Run</strong>.
              </>,
              <>Manage (pause/delete) on the Dashboard's Scheduled Runs card; results land in Runs like any other run.</>,
            ]}
          />
          <Callout tone="tip" icon={AlertTriangle}>
            Schedules fire <strong>only while the app is open</strong> — there's no background service.
          </Callout>
        </Section>

        <Section id="repository" title="11 · Repository — the built-in git client">
          <Steps
            items={[
              <>
                <strong>Repository</strong> in the sidebar → pick the project → paste the repo's HTTPS URL + a GitHub token (for private repos /
                pushing; stored encrypted on this device) → <strong>Clone</strong>.
              </>,
              <>
                <strong>Working Copy</strong>: stage/unstage/discard files, per-file line diffs, commit box — commits are authored as your signed-in
                account.
              </>,
              <>
                <strong>History</strong>: the commit graph with colored branch lanes and branch labels; click a commit for its files and diffs.
              </>,
              <>Branch rail: click to switch, click a remote-only branch to check it out, create branches inline.</>,
              <>
                Toolbar: <strong>Pull / Push / Fetch</strong> with ↑ ahead / ↓ behind counters.
              </>,
            ]}
          />
          <Callout tone="tip" icon={AlertTriangle}>
            Merge conflicts can't be resolved in-app — a conflicting pull shows an error; resolve in a full git tool, then come back.
          </Callout>
        </Section>

        <Section id="steps" title="12 · Step types reference">
          <GuideTable
            head={['Type', 'What it does', 'Value means']}
            rows={[
              [<Mono key="t">goto</Mono>, 'Navigate to a URL (relative resolves against the environment base URL)', 'the URL'],
              [<Mono key="t">click</Mono>, 'Click the element matching the selector', '—'],
              [<Mono key="t">fill</Mono>, 'Type into an input', 'the text'],
              [<Mono key="t">press</Mono>, 'Press a keyboard key', 'e.g. Enter'],
              [<Mono key="t">select</Mono>, 'Choose a dropdown option', 'the option'],
              [<Mono key="t">waitFor</Mono>, 'Wait until the selector exists', '—'],
              [<Mono key="t">assertVisible</Mono>, 'Assert the element is visible — fails the run if not', '—'],
              [<Mono key="t">assertText</Mono>, "Assert the element's text contains the value", 'expected text'],
            ]}
          />
          <p>Each step has a 10-second default timeout. Suites export and import as plain JSON files.</p>
        </Section>

        <Section id="cli" title="13 · CLI & automation">
          <p>
            While the app is open and signed in, a REST API listens on <Mono>127.0.0.1:4317</Mono> (port in Settings). The bundled CLI wraps it:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-secondary px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
            {`qaflow run --project "Golden Paws" --suite "Login works" --env Production
qaflow status --project "Golden Paws"
qaflow report --run-id <id> --format json`}
          </pre>
          <p>
            <Mono>qaflow run</Mono> exits non-zero on failure (CI-friendly). The deploy webhook{' '}
            <Mono>POST /webhooks/deploy-complete</Mono> with <Mono>{'{"projectId":"…","tag":"smoke"}'}</Mono> runs every suite tagged{' '}
            <Mono>smoke</Mono> for that project.
          </p>
        </Section>

        <Section id="troubleshooting" title="14 · Troubleshooting">
          <GuideTable
            head={['Symptom', 'Cause & fix']}
            rows={[
              ['"Browser is still installing"', 'First-run Chromium download — wait a minute and retry.'],
              ['"The app was updated behind this window"', 'A newer build replaced files while this window was open — click Reload app.'],
              ['Suite fails on a selector timeout', 'The UI changed — open Suite Detail and fix or re-record that step.'],
              ['Video link stopped working', 'Signed links expire after 1 hour — reopen the run and copy a fresh one.'],
              ["Credential profile won't run on my machine", 'Its secret lives on the machine that captured it — capture the session again here (§9).'],
              ['"Not signed in" errors', 'Your session ended — sign in again.'],
              ["Scheduled run didn't happen", 'The app was closed at the scheduled time (§10).'],
              ['Push/pull fails in Repository', 'Missing/invalid GitHub token, or a merge conflict (needs an external git tool).'],
            ]}
          />
        </Section>

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          This guide mirrors <Mono>docs/MANUAL.md</Mono> in the repository. Companion docs: the QA Field Guide (onboarding) and USER_GUIDE.md.
        </p>
      </div>

      <aside className="sticky top-8 hidden h-fit w-56 shrink-0 xl:block">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contents</div>
          <nav className="flex flex-col">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => jump(s.id)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
                  active === s.id ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                {s.title}
              </button>
            ))}
          </nav>
        </div>
      </aside>
    </div>
  );
};
