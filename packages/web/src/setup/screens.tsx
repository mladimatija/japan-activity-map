import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { t } from '../i18n.ts';
import { cn } from '../lib/utils.ts';
import type { SetupApi, SetupState, Start, View } from './api.ts';
import { said, StepCard } from './StepCard.tsx';

export const Screen = ({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-4">
    <header>
      <h2 className="text-title font-bold">{title}</h2>
      {lead && <p className="mt-1 text-sm text-muted-foreground">{lead}</p>}
    </header>
    {children}
  </section>
);

export interface Waypoint {
  label: string;
  /** done: behind you. now: where you are. todo: still ahead. */
  state: 'done' | 'now' | 'todo';
  note?: string;
}

/**
 * A route with its waypoints, in the map's own marks: a filled pin for what is done, a ring for
 * what is not. Used for where the setup stands and for where you are in it; both are sequences.
 */
export const Trail = ({ label, points }: { label: string; points: Waypoint[] }) => (
  <ol
    aria-label={label}
    className="flex flex-col gap-2 sm:grid sm:gap-0"
    style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
  >
    {points.map((point, index) => (
      <li
        key={point.label}
        aria-current={point.state === 'now' ? 'step' : undefined}
        className="flex items-start gap-2.5 sm:flex-col sm:gap-2 sm:pr-4"
      >
        <span className="flex items-center self-stretch max-sm:pt-1 sm:w-full">
          <span
            className={cn(
              'size-3 shrink-0 rounded-full border-2',
              point.state === 'done' && 'border-status-done bg-status-done',
              point.state === 'now' && 'border-primary bg-card ring-4 ring-primary/15',
              point.state === 'todo' && 'border-input bg-card',
            )}
          />
          {index < points.length - 1 && (
            <span
              className={cn(
                'h-0.5 flex-1 max-sm:hidden',
                point.state === 'done' ? 'bg-status-done' : 'bg-border',
              )}
            />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'text-compact font-semibold',
              point.state === 'todo' && 'font-normal text-muted-foreground',
            )}
          >
            {point.label}
          </span>
          {point.note && <span className="text-xs text-muted-foreground">{point.note}</span>}
        </span>
      </li>
    ))}
  </ol>
);

/** What each group of settings holds, said in a few words under its name. */
const GROUP_HINTS: Record<string, string> = {
  site: 'Title, description, address',
  map: 'Base map, dark map, terrain',
  views: 'The saved views in the filter panel',
  publish: 'Names, links, time of day, pace',
  output: 'Detail and size of the files',
  sources: 'Strava, a sheet, or both',
  'source:strava': 'Dates, activity types, sign-in',
  'source:sheet': 'The file and its time zone',
  privacy: 'Zones, and how their edges are blurred',
  lists: 'Which reference lists to download',
  matching: 'How close counts as reached',
  routeGrouping: 'When two tracks are one route',
  routes: 'Names, merges and splits',
  deploy: 'Where the site is published',
};

/** The first screen: where things stand, the ways through the settings, and changing one group. */
export const Welcome = ({
  state,
  onStart,
}: {
  state: SetupState;
  onStart: (start: Start, group?: string) => void;
}) => {
  const { facts } = state;
  const points: Waypoint[] = [
    {
      label: t('Strava application'),
      state: facts.stravaCredentials ? 'done' : 'todo',
      note: facts.stravaCredentials ? t('Details stored') : t('Not yet'),
    },
    {
      label: t('Strava sign-in'),
      state: facts.stravaScope ? 'done' : 'todo',
      note: facts.stravaScope ? t('Signed in') : t('Not yet'),
    },
    {
      label: t('Privacy zones'),
      state: state.zones > 0 ? 'done' : 'todo',
      note:
        state.zones > 0
          ? t('{count} set', { count: state.zones })
          : t('None: tracks show where they start'),
    },
    {
      label: t('Site data'),
      state: facts.siteBuilt ? 'done' : 'todo',
      note: facts.siteBuilt ? t('Built') : t('Not built yet'),
    },
  ];
  // With a site already built, changing one thing is the likely errand; on a fresh clone it is
  // the quick setup. The likelier one comes first and carries the page's one filled button.
  const ready = facts.siteBuilt && state.zones > 0;
  const demoBlocked = !state.demo.available;

  const paths = (
    <div className="grid gap-3 md:grid-cols-5">
      <div className="flex flex-col gap-3 md:col-span-2">
        {(
          [
            {
              start: 'demo',
              title: 'Try with demo data',
              text: 'A made-up history in a folder of its own, to see the site before connecting anything. Your own activities, settings and site stay as they are.',
              action: 'Make the demo',
            },
            {
              start: 'full',
              title: 'Full setup',
              text: 'Every setting, group by group.',
              action: 'Start full setup',
            },
          ] as const
        ).map((path) => {
          const blocked = path.start === 'demo' && demoBlocked;
          return (
            <section
              key={path.start}
              aria-labelledby={`path-${path.start}`}
              className="flex flex-1 flex-col gap-2 rounded-xl border bg-card p-4"
            >
              <h3 id={`path-${path.start}`} className="text-row font-semibold">
                {t(path.title)}
              </h3>
              <p className="text-compact text-muted-foreground">{t(path.text)}</p>
              <Button
                className="mt-auto self-start"
                variant="outline"
                size="sm"
                disabled={blocked}
                onClick={() => onStart(path.start)}
              >
                {t(path.action)}
              </Button>
              {blocked && (
                <p className="text-xs text-muted-foreground">
                  {t('Not available in this version.')}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <section
        aria-labelledby="path-quick"
        className="flex flex-col gap-3 rounded-xl border bg-card p-5 md:col-span-3"
      >
        <h3 id="path-quick" className="text-title font-bold">
          {t('Quick setup')}
        </h3>
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          {t('About nine questions with the recommended defaults, then the first sync and build.')}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-compact">
          {['Site title', 'Where activities come from', 'Home to hide', 'What to publish'].map(
            (asked) => (
              <li key={asked} className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-status-done" />
                {t(asked)}
              </li>
            ),
          )}
        </ul>
        <Button
          className="mt-auto self-start"
          variant={ready ? 'outline' : 'default'}
          onClick={() => onStart('quick')}
        >
          {t('Start quick setup')}
        </Button>
      </section>
    </div>
  );

  const change = (
    <section aria-labelledby="change-title" className="flex flex-col gap-3">
      <div>
        <h3 id="change-title" className="text-row font-semibold">
          {t('Change settings')}
        </h3>
        <p className="text-compact text-muted-foreground">
          {t('One group at a time, starting from what is set now. A diff is shown before saving.')}
        </p>
      </div>
      <ul className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 md:grid-cols-3">
        {state.groups.map((group) => (
          <li key={group.id} className="-mt-px -ml-px border-t border-l">
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-2 px-4 py-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => onStart('change', group.id)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-compact font-semibold">{t(group.title)}</span>
                {GROUP_HINTS[group.id] && (
                  <span className="truncate text-xs text-muted-foreground">
                    {t(GROUP_HINTS[group.id] ?? '')}
                  </span>
                )}
              </span>
              <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <section className="flex flex-col gap-7">
      <header className="flex flex-col gap-2">
        <h2 className="text-display font-bold tracking-tight">
          {ready ? t('Your map is set up') : t('Set up your map')}
        </h2>
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          {ready
            ? t(
                'Change one group of settings, or run a setup again. Every change is shown before it is written, and this page talks only to the setup command on this computer.',
              )
            : t(
                'This page asks what it needs, shows every change before writing it, and runs the first sync and build. It talks only to the setup command running on this computer.',
              )}
        </p>
      </header>
      <div className="border-y py-4">
        <Trail label={t('Where the setup stands')} points={points} />
      </div>
      {ready ? (
        <>
          {change}
          {paths}
        </>
      ) : (
        <>
          {paths}
          {change}
        </>
      )}
    </section>
  );
};

const CHECKLIST = [
  'Open strava.com/settings/api and create an application.',
  'Set its Authorization Callback Domain to "localhost".',
  'Ask Strava to raise it to "up to 10 athletes"; without that the API answers 403.',
  'Reading activities through the API needs a Strava subscription.',
];

const StravaChecklist = () => (
  <Alert>
    <AlertTitle>{t('Before the Strava questions')}</AlertTitle>
    <AlertDescription>
      <ol className="list-decimal pl-5">
        {CHECKLIST.map((line) => (
          <li key={line}>{t(line)}</li>
        ))}
      </ol>
      <p className="mt-1">{t('The sign-in itself happens later, on the run screen.')}</p>
    </AlertDescription>
  </Alert>
);

/** What would change, file by file, and what would run. Secrets arrive masked from the server. */
export const Changes = ({ view, start }: { view: View; start: Start }) => (
  <div className="flex flex-col gap-3">
    <h3 className="text-row font-semibold">{t('What will change')}</h3>
    {view.changes.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('No config file needs to change.')}</p>
    ) : (
      view.changes.map((change) => (
        <div key={change.name} className="rounded-lg border bg-card px-3 py-2.5">
          <p className="text-compact font-semibold">
            config/{change.name}
            {change.created && (
              <span className="ml-2 font-normal text-muted-foreground">{t('new file')}</span>
            )}
          </p>
          <pre className="mt-1 overflow-auto text-xs">{change.diff.join('\n')}</pre>
        </div>
      ))
    )}
    {view.plan.length > 0 && (
      <>
        <h3 className="text-row font-semibold">
          {start === 'change' ? t('To bring things up to date') : t('Then these run')}
        </h3>
        <ol className="list-decimal pl-5 text-compact">
          {view.plan.map((action) => (
            <li key={action.id}>
              {t(action.title)}
              {action.skip && (
                <span className="text-muted-foreground">
                  {' '}
                  {t('Left out: {why}.', { why: said(action.skip) })}
                </span>
              )}
            </li>
          ))}
        </ol>
      </>
    )}
  </div>
);

export interface StepsProps {
  start: Start;
  view: View;
  state: SetupState;
  answers: Record<string, unknown>;
  /** Which group's page is open, in full setup. */
  page: number;
  saving: boolean;
  onAnswer: (id: string, value: unknown) => void;
  onPage: (page: number) => void;
  onSave: () => void;
  onBack: () => void;
  onUpload?: SetupApi['upload'];
}

/** The steps as cards. Full setup goes group by group; the other modes fit one page. */
export const Steps = ({
  start,
  view,
  state,
  answers,
  page,
  saving,
  onAnswer,
  onPage,
  onSave,
  onBack,
  onUpload,
}: StepsProps) => {
  const groups = [...new Set(view.steps.map((step) => step.group))];
  const paged = start === 'full';
  const current = paged ? groups[Math.min(page, groups.length - 1)] : undefined;
  const shownGroups = paged ? groups.filter((group) => group === current) : groups;
  const last = !paged || page >= groups.length - 1;
  const wrong = Object.keys(view.errors).length;
  return (
    <div className="flex flex-col gap-4">
      {paged && (
        <nav aria-label={t('Groups')} className="flex flex-wrap gap-1.5">
          {groups.map((group, index) => (
            <Button
              key={group}
              size="sm"
              variant="outline"
              aria-current={group === current ? 'step' : undefined}
              className={cn(group === current && 'border-primary bg-accent text-accent-foreground')}
              onClick={() => onPage(index)}
            >
              {t(state.titles[group] ?? group)}
              {view.steps.some((step) => step.group === group && view.errors[step.id]) && ' !'}
            </Button>
          ))}
        </nav>
      )}
      {shownGroups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-row font-semibold">
              {t(state.titles[group] ?? group)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {group === 'source:strava' && start !== 'change' && <StravaChecklist />}
            {group === 'deploy' && (
              <Alert>
                <AlertDescription>
                  {t(
                    'A token typed here is stored in config/secrets.jsonc on this computer and goes nowhere else; it can be left empty and added later. GitHub Pages needs none. docs/deploy.md says where to find each.',
                  )}
                </AlertDescription>
              </Alert>
            )}
            {view.steps
              .filter((step) => step.group === group && step.id !== 'privacy.radius')
              .map((step) => (
                <StepCard
                  key={step.id}
                  step={step}
                  answer={answers[step.id]}
                  answers={answers}
                  error={view.errors[step.id]}
                  mapStyle={state.mapStyle}
                  onAnswer={onAnswer}
                  onUpload={onUpload}
                />
              ))}
          </CardContent>
        </Card>
      ))}
      {last && <Changes view={view} start={start} />}
      {wrong > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t('{count} answers need another look before saving.', { count: wrong })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={paged && page > 0 ? () => onPage(page - 1) : onBack}>
          {t('Back')}
        </Button>
        {last ? (
          <Button disabled={saving || wrong > 0} onClick={onSave}>
            {view.changes.length > 0 ? t('Save these changes') : t('Continue')}
          </Button>
        ) : (
          <Button onClick={() => onPage(page + 1)}>{t('Next')}</Button>
        )}
      </div>
    </div>
  );
};

/** The last screen: what to type next, and the button that stops the local server. */
export const Done = ({
  closed,
  demo,
  onFinish,
}: {
  closed: boolean;
  demo: boolean;
  /** Whether Strava is one of the sources: the weekly line syncs it first. */
  onFinish: () => void;
}) => (
  <Screen title={t('Setup is complete')}>
    <dl className="flex flex-col gap-3 text-sm">
      {(demo
        ? [['Remove the demo data later', 'pnpm jam demo --clear']]
        : [
            ['See the site', 'pnpm web:preview'],
            ['Each week, or whenever you want the site up to date', 'pnpm jam update'],
            ['Change a setting later', 'pnpm jam setup --change'],
          ]
      ).map(([what, command]) => (
        <div key={command}>
          <dt className="text-muted-foreground">{t(what ?? '')}</dt>
          <dd>
            <code className="text-xs break-all">{command}</code>
          </dd>
        </div>
      ))}
    </dl>
    <p className="text-sm text-muted-foreground">
      {t('To publish the site, see docs/deploy.md, then run pnpm jam deploy.')}
    </p>
    {closed ? (
      <p role="status" className="text-sm font-semibold">
        {t('The setup command has stopped. You can close this tab.')}
      </p>
    ) : (
      <Button className="self-start" onClick={onFinish}>
        {t('Finish and stop the setup command')}
      </Button>
    )}
  </Screen>
);
